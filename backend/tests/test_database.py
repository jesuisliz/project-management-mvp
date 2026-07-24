from contextlib import closing
from pathlib import Path
import sqlite3

import pytest

from backend.database import (
    BoardNotFoundError,
    CardNotFoundError,
    LabelNotFoundError,
    LastBoardError,
    UsernameTakenError,
    create_board,
    create_card,
    create_label,
    delete_board,
    delete_label,
    get_board,
    initialize_database,
    list_boards,
    provision_user,
    register_user,
    rename_column,
    rename_label,
    set_card_labels,
    verify_login,
)


def connect(database_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def board_id(database_path: Path, username: str) -> int:
    return list_boards(database_path, username)[0]["id"]


def test_missing_database_is_created_and_seeded(tmp_path: Path) -> None:
    database_path = tmp_path / "nested" / "pm.db"

    initialize_database(database_path)
    board = get_board(database_path, "user", board_id(database_path, "user"))

    assert database_path.is_file()
    assert [column["id"] for column in board["columns"]] == [
        "col-backlog",
        "col-discovery",
        "col-progress",
        "col-review",
        "col-done",
    ]
    assert len(board["cards"]) == 8
    assert board["labels"] == []


def test_initialization_is_idempotent_and_preserves_existing_data(
    database_path: Path,
) -> None:
    initialize_database(database_path)
    bid = board_id(database_path, "user")
    rename_column(database_path, "user", bid, "col-backlog", "Ready")

    initialize_database(database_path)
    board = get_board(database_path, "user", bid)

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
            "INSERT INTO users (username, password_hash) "
            "VALUES ('unprovisioned', 'hash') RETURNING id"
        ).fetchone()[0]
        orphan_board_id = connection.execute(
            "INSERT INTO boards (user_id, name) VALUES (?, 'Board') RETURNING id",
            (user_id,),
        ).fetchone()[0]

        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO cards (
                    board_id, id, column_id, position, title, details
                ) VALUES (?, 'foreign-card', 'col-backlog', 0, 'Card', '')
                """,
                (orphan_board_id,),
            )

        mvp_board_id = board_id(database_path, "user")
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
    bid = board_id(database_path, "user")
    rename_column(database_path, "user", bid, "col-review", "Verification")

    board = get_board(database_path, "user", bid)

    assert board["columns"][3]["title"] == "Verification"


def test_each_user_receives_an_independent_first_board(
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
    other_board_id = board_id(database_path, "other-user")
    assert len(get_board(database_path, "other-user", other_board_id)["cards"]) == 8


def test_register_user_creates_hashed_credentials_and_an_empty_board(
    database_path: Path,
) -> None:
    initialize_database(database_path)

    register_user(database_path, "fresh", "correct horse")

    assert verify_login(database_path, "fresh", "correct horse") is True
    assert verify_login(database_path, "fresh", "wrong password") is False
    with closing(connect(database_path)) as connection:
        stored_hash = connection.execute(
            "SELECT password_hash FROM users WHERE username = 'fresh'"
        ).fetchone()[0]
    assert "correct horse" not in stored_hash

    bid = board_id(database_path, "fresh")
    assert get_board(database_path, "fresh", bid)["cards"] == {}


def test_register_user_rejects_duplicate_username(database_path: Path) -> None:
    initialize_database(database_path)
    register_user(database_path, "taken", "password1")

    with pytest.raises(UsernameTakenError):
        register_user(database_path, "taken", "password2")


def test_register_user_rejects_blank_fields(database_path: Path) -> None:
    initialize_database(database_path)

    with pytest.raises(ValueError):
        register_user(database_path, "   ", "password")
    with pytest.raises(ValueError):
        register_user(database_path, "someone", "")


def test_create_rename_and_delete_board(database_path: Path) -> None:
    initialize_database(database_path)

    created = create_board(database_path, "user", "Second board")
    boards = list_boards(database_path, "user")
    assert [board["name"] for board in boards] == ["My Board", "Second board"]

    create_card(
        database_path,
        "user",
        created["id"],
        "col-backlog",
        "Card on second board",
        "",
    )
    delete_board(database_path, "user", created["id"])
    assert [board["name"] for board in list_boards(database_path, "user")] == [
        "My Board"
    ]


def test_cannot_delete_the_last_board(database_path: Path) -> None:
    initialize_database(database_path)
    bid = board_id(database_path, "user")

    with pytest.raises(LastBoardError):
        delete_board(database_path, "user", bid)


def test_board_operations_reject_another_users_board_id(
    database_path: Path,
) -> None:
    initialize_database(database_path)
    provision_user(database_path, "other-user")
    other_board_id = board_id(database_path, "other-user")

    with pytest.raises(BoardNotFoundError):
        get_board(database_path, "user", other_board_id)


def test_label_lifecycle_and_card_assignment(database_path: Path) -> None:
    initialize_database(database_path)
    bid = board_id(database_path, "user")

    board = create_label(database_path, "user", bid, "Urgent", "#ecad0a")
    label_id = board["labels"][0]["id"]

    board = set_card_labels(database_path, "user", bid, "card-1", [label_id])
    assert board["cards"]["card-1"]["labelIds"] == [label_id]

    board = rename_label(database_path, "user", bid, label_id, "Blocked", "#753991")
    assert board["labels"][0] == {
        "id": label_id,
        "name": "Blocked",
        "color": "#753991",
    }

    board = delete_label(database_path, "user", bid, label_id)
    assert board["labels"] == []
    assert board["cards"]["card-1"]["labelIds"] == []


def test_assigning_unknown_label_is_rejected(database_path: Path) -> None:
    initialize_database(database_path)
    bid = board_id(database_path, "user")

    with pytest.raises(LabelNotFoundError):
        set_card_labels(database_path, "user", bid, "card-1", ["missing-label"])


def test_assigning_labels_to_unknown_card_is_rejected(database_path: Path) -> None:
    initialize_database(database_path)
    bid = board_id(database_path, "user")

    with pytest.raises(CardNotFoundError):
        set_card_labels(database_path, "user", bid, "missing-card", [])
