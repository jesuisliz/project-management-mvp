from contextlib import closing
from pathlib import Path
import sqlite3

import pytest

from backend.database import (
    get_board,
    initialize_database,
    provision_user,
    rename_column,
)


def connect(database_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def test_missing_database_is_created_and_seeded(tmp_path: Path) -> None:
    database_path = tmp_path / "nested" / "pm.db"

    initialize_database(database_path)
    board = get_board(database_path, "user")

    assert database_path.is_file()
    assert [column["id"] for column in board["columns"]] == [
        "col-backlog",
        "col-discovery",
        "col-progress",
        "col-review",
        "col-done",
    ]
    assert len(board["cards"]) == 8


def test_initialization_is_idempotent_and_preserves_existing_data(
    database_path: Path,
) -> None:
    initialize_database(database_path)
    rename_column(database_path, "user", "col-backlog", "Ready")

    initialize_database(database_path)
    board = get_board(database_path, "user")

    assert board["columns"][0]["title"] == "Ready"
    assert len(board["columns"]) == 5
    assert len(board["cards"]) == 8


def test_foreign_keys_and_ordering_constraints_are_enforced(
    database_path: Path,
) -> None:
    initialize_database(database_path)
    provision_user(database_path, "other-user")

    with closing(connect(database_path)) as connection:
        assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        user_id = connection.execute(
            "INSERT INTO users (username) VALUES ('unprovisioned') RETURNING id"
        ).fetchone()[0]
        board_id = connection.execute(
            "INSERT INTO boards (user_id) VALUES (?) RETURNING id",
            (user_id,),
        ).fetchone()[0]

        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO cards (
                    board_id, id, column_id, position, title, details
                ) VALUES (?, 'foreign-card', 'col-backlog', 0, 'Card', '')
                """,
                (board_id,),
            )

        mvp_board_id = connection.execute(
            """
            SELECT boards.id
            FROM boards
            JOIN users ON users.id = boards.user_id
            WHERE users.username = 'user'
            """
        ).fetchone()[0]
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO cards (
                    board_id, id, column_id, position, title, details
                ) VALUES (?, 'duplicate-position', 'col-backlog', 0, 'Card', '')
                """,
                (mvp_board_id,),
            )


def test_data_persists_after_reconnect(database_path: Path) -> None:
    initialize_database(database_path)
    rename_column(database_path, "user", "col-review", "Verification")

    board = get_board(database_path, "user")

    assert board["columns"][3]["title"] == "Verification"


def test_each_user_receives_an_independent_single_board(
    database_path: Path,
) -> None:
    initialize_database(database_path)
    provision_user(database_path, "other-user")
    provision_user(database_path, "other-user")

    with closing(connect(database_path)) as connection:
        rows = connection.execute(
            """
            SELECT users.username, count(boards.id) AS board_count
            FROM users
            JOIN boards ON boards.user_id = users.id
            GROUP BY users.id
            ORDER BY users.username
            """
        ).fetchall()

    assert [(row["username"], row["board_count"]) for row in rows] == [
        ("other-user", 1),
        ("user", 1),
    ]
    assert len(get_board(database_path, "other-user")["cards"]) == 8
