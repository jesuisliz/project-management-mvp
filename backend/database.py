from contextlib import closing
from pathlib import Path
import sqlite3
from uuid import uuid4


MVP_USERNAME = "user"

DEFAULT_COLUMNS = (
    ("col-backlog", 0, "Backlog"),
    ("col-discovery", 1, "Discovery"),
    ("col-progress", 2, "In Progress"),
    ("col-review", 3, "Review"),
    ("col-done", 4, "Done"),
)

DEFAULT_CARDS = (
    (
        "card-1",
        "col-backlog",
        0,
        "Align roadmap themes",
        "Draft quarterly themes with impact statements and metrics.",
    ),
    (
        "card-2",
        "col-backlog",
        1,
        "Gather customer signals",
        "Review support tags, sales notes, and churn feedback.",
    ),
    (
        "card-3",
        "col-discovery",
        0,
        "Prototype analytics view",
        "Sketch initial dashboard layout and key drill-downs.",
    ),
    (
        "card-4",
        "col-progress",
        0,
        "Refine status language",
        "Standardize column labels and tone across the board.",
    ),
    (
        "card-5",
        "col-progress",
        1,
        "Design card layout",
        "Add hierarchy and spacing for scanning dense lists.",
    ),
    (
        "card-6",
        "col-review",
        0,
        "QA micro-interactions",
        "Verify hover, focus, and loading states.",
    ),
    (
        "card-7",
        "col-done",
        0,
        "Ship marketing page",
        "Final copy approved and asset pack delivered.",
    ),
    (
        "card-8",
        "col-done",
        1,
        "Close onboarding sprint",
        "Document release notes and share internally.",
    ),
)

SCHEMA_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL,
        CONSTRAINT uq_users_username UNIQUE (username),
        CONSTRAINT ck_users_username_not_blank
            CHECK (length(trim(username)) > 0)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS boards (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        CONSTRAINT uq_boards_user_id UNIQUE (user_id),
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS columns (
        board_id INTEGER NOT NULL,
        id TEXT NOT NULL,
        position INTEGER NOT NULL,
        title TEXT NOT NULL,
        PRIMARY KEY (board_id, id),
        CONSTRAINT uq_columns_board_position UNIQUE (board_id, position),
        CONSTRAINT ck_columns_position
            CHECK (position >= 0 AND position < 5),
        CONSTRAINT ck_columns_title_not_blank
            CHECK (length(trim(title)) > 0),
        FOREIGN KEY (board_id) REFERENCES boards (id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS cards (
        board_id INTEGER NOT NULL,
        id TEXT NOT NULL,
        column_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        title TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (board_id, id),
        CONSTRAINT uq_cards_column_position
            UNIQUE (board_id, column_id, position),
        CONSTRAINT ck_cards_position CHECK (position >= 0),
        CONSTRAINT ck_cards_title_not_blank
            CHECK (length(trim(title)) > 0),
        FOREIGN KEY (board_id) REFERENCES boards (id) ON DELETE CASCADE,
        FOREIGN KEY (board_id, column_id)
            REFERENCES columns (board_id, id) ON DELETE CASCADE
    )
    """,
)


class BoardNotFoundError(Exception):
    pass


class ColumnNotFoundError(Exception):
    pass


class CardNotFoundError(Exception):
    pass


class InvalidMoveError(Exception):
    pass


def _connect(database_path: str | Path) -> sqlite3.Connection:
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database(database_path: str | Path) -> None:
    path = Path(database_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with closing(_connect(path)) as connection, connection:
        for statement in SCHEMA_STATEMENTS:
            connection.execute(statement)
        _provision_user(connection, MVP_USERNAME)


def provision_user(database_path: str | Path, username: str) -> None:
    with closing(_connect(database_path)) as connection, connection:
        _provision_user(connection, username)


def _provision_user(connection: sqlite3.Connection, username: str) -> None:
    normalized_username = username.strip()
    if not normalized_username:
        raise ValueError("Username cannot be blank")

    connection.execute(
        "INSERT OR IGNORE INTO users (username) VALUES (?)",
        (normalized_username,),
    )
    user_row = connection.execute(
        "SELECT id FROM users WHERE username = ?",
        (normalized_username,),
    ).fetchone()
    if user_row is None:
        raise RuntimeError("Unable to provision user")

    board_row = connection.execute(
        "SELECT id FROM boards WHERE user_id = ?",
        (user_row["id"],),
    ).fetchone()
    if board_row is not None:
        return

    cursor = connection.execute(
        "INSERT INTO boards (user_id) VALUES (?)",
        (user_row["id"],),
    )
    board_id = cursor.lastrowid
    if board_id is None:
        raise RuntimeError("Unable to provision board")

    connection.executemany(
        """
        INSERT INTO columns (board_id, id, position, title)
        VALUES (?, ?, ?, ?)
        """,
        (
            (board_id, column_id, position, title)
            for column_id, position, title in DEFAULT_COLUMNS
        ),
    )
    connection.executemany(
        """
        INSERT INTO cards (
            board_id, id, column_id, position, title, details
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            (board_id, card_id, column_id, position, title, details)
            for card_id, column_id, position, title, details in DEFAULT_CARDS
        ),
    )


def _get_board_id(connection: sqlite3.Connection, username: str) -> int:
    row = connection.execute(
        """
        SELECT boards.id
        FROM boards
        JOIN users ON users.id = boards.user_id
        WHERE users.username = ?
        """,
        (username,),
    ).fetchone()
    if row is None:
        raise BoardNotFoundError
    return int(row["id"])


def _read_board(
    connection: sqlite3.Connection,
    board_id: int,
) -> dict[str, object]:
    column_rows = connection.execute(
        """
        SELECT id, title
        FROM columns
        WHERE board_id = ?
        ORDER BY position
        """,
        (board_id,),
    ).fetchall()
    card_rows = connection.execute(
        """
        SELECT id, column_id, title, details
        FROM cards
        WHERE board_id = ?
        ORDER BY column_id, position
        """,
        (board_id,),
    ).fetchall()

    card_ids_by_column = {row["id"]: [] for row in column_rows}
    cards: dict[str, dict[str, str]] = {}
    for row in card_rows:
        card_ids_by_column[row["column_id"]].append(row["id"])
        cards[row["id"]] = {
            "id": row["id"],
            "title": row["title"],
            "details": row["details"],
        }

    columns = [
        {
            "id": row["id"],
            "title": row["title"],
            "cardIds": card_ids_by_column[row["id"]],
        }
        for row in column_rows
    ]
    return {"columns": columns, "cards": cards}


def get_board(database_path: str | Path, username: str) -> dict[str, object]:
    with closing(_connect(database_path)) as connection:
        board_id = _get_board_id(connection, username)
        return _read_board(connection, board_id)


def rename_column(
    database_path: str | Path,
    username: str,
    column_id: str,
    title: str,
) -> dict[str, object]:
    with closing(_connect(database_path)) as connection, connection:
        board_id = _get_board_id(connection, username)
        cursor = connection.execute(
            """
            UPDATE columns
            SET title = ?
            WHERE board_id = ? AND id = ?
            """,
            (title, board_id, column_id),
        )
        if cursor.rowcount == 0:
            raise ColumnNotFoundError
        return _read_board(connection, board_id)


def create_card(
    database_path: str | Path,
    username: str,
    column_id: str,
    title: str,
    details: str,
) -> dict[str, object]:
    with closing(_connect(database_path)) as connection, connection:
        board_id = _get_board_id(connection, username)
        column = connection.execute(
            "SELECT 1 FROM columns WHERE board_id = ? AND id = ?",
            (board_id, column_id),
        ).fetchone()
        if column is None:
            raise ColumnNotFoundError

        next_position = connection.execute(
            """
            SELECT count(*) AS count
            FROM cards
            WHERE board_id = ? AND column_id = ?
            """,
            (board_id, column_id),
        ).fetchone()["count"]
        card_id = f"card-{uuid4().hex}"
        connection.execute(
            """
            INSERT INTO cards (
                board_id, id, column_id, position, title, details
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (board_id, card_id, column_id, next_position, title, details),
        )
        return _read_board(connection, board_id)


def edit_card(
    database_path: str | Path,
    username: str,
    card_id: str,
    title: str,
    details: str,
) -> dict[str, object]:
    with closing(_connect(database_path)) as connection, connection:
        board_id = _get_board_id(connection, username)
        cursor = connection.execute(
            """
            UPDATE cards
            SET title = ?, details = ?
            WHERE board_id = ? AND id = ?
            """,
            (title, details, board_id, card_id),
        )
        if cursor.rowcount == 0:
            raise CardNotFoundError
        return _read_board(connection, board_id)


def _card_ids(
    connection: sqlite3.Connection,
    board_id: int,
    column_id: str,
) -> list[str]:
    rows = connection.execute(
        """
        SELECT id
        FROM cards
        WHERE board_id = ? AND column_id = ?
        ORDER BY position
        """,
        (board_id, column_id),
    ).fetchall()
    return [row["id"] for row in rows]


def _stage_columns(
    connection: sqlite3.Connection,
    board_id: int,
    column_ids: tuple[str, ...],
) -> int:
    placeholders = ", ".join("?" for _ in column_ids)
    max_position = connection.execute(
        f"""
        SELECT coalesce(max(position), -1) AS max_position
        FROM cards
        WHERE board_id = ? AND column_id IN ({placeholders})
        """,
        (board_id, *column_ids),
    ).fetchone()["max_position"]
    total_cards = connection.execute(
        f"""
        SELECT count(*) AS count
        FROM cards
        WHERE board_id = ? AND column_id IN ({placeholders})
        """,
        (board_id, *column_ids),
    ).fetchone()["count"]
    offset = max_position + total_cards + 2
    for column_id in column_ids:
        connection.execute(
            """
            UPDATE cards
            SET position = position + ?
            WHERE board_id = ? AND column_id = ?
            """,
            (offset, board_id, column_id),
        )
    return offset + max_position + 1


def _assign_order(
    connection: sqlite3.Connection,
    board_id: int,
    column_id: str,
    card_ids: list[str],
) -> None:
    for position, card_id in enumerate(card_ids):
        connection.execute(
            """
            UPDATE cards
            SET position = ?
            WHERE board_id = ? AND column_id = ? AND id = ?
            """,
            (position, board_id, column_id, card_id),
        )


def delete_card(
    database_path: str | Path,
    username: str,
    card_id: str,
) -> dict[str, object]:
    with closing(_connect(database_path)) as connection, connection:
        board_id = _get_board_id(connection, username)
        card = connection.execute(
            """
            SELECT column_id
            FROM cards
            WHERE board_id = ? AND id = ?
            """,
            (board_id, card_id),
        ).fetchone()
        if card is None:
            raise CardNotFoundError

        column_id = card["column_id"]
        connection.execute(
            "DELETE FROM cards WHERE board_id = ? AND id = ?",
            (board_id, card_id),
        )
        remaining_ids = _card_ids(connection, board_id, column_id)
        _stage_columns(connection, board_id, (column_id,))
        _assign_order(connection, board_id, column_id, remaining_ids)
        return _read_board(connection, board_id)


def move_card(
    database_path: str | Path,
    username: str,
    card_id: str,
    destination_column_id: str,
    destination_position: int,
) -> dict[str, object]:
    with closing(_connect(database_path)) as connection, connection:
        board_id = _get_board_id(connection, username)
        card = connection.execute(
            """
            SELECT column_id
            FROM cards
            WHERE board_id = ? AND id = ?
            """,
            (board_id, card_id),
        ).fetchone()
        if card is None:
            raise CardNotFoundError

        destination = connection.execute(
            "SELECT 1 FROM columns WHERE board_id = ? AND id = ?",
            (board_id, destination_column_id),
        ).fetchone()
        if destination is None:
            raise ColumnNotFoundError

        source_column_id = card["column_id"]
        source_ids = _card_ids(connection, board_id, source_column_id)
        source_ids.remove(card_id)

        if source_column_id == destination_column_id:
            if destination_position > len(source_ids):
                raise InvalidMoveError
            source_ids.insert(destination_position, card_id)
            _stage_columns(connection, board_id, (source_column_id,))
            _assign_order(connection, board_id, source_column_id, source_ids)
        else:
            destination_ids = _card_ids(
                connection,
                board_id,
                destination_column_id,
            )
            if destination_position > len(destination_ids):
                raise InvalidMoveError
            destination_ids.insert(destination_position, card_id)

            temporary_position = _stage_columns(
                connection,
                board_id,
                (source_column_id, destination_column_id),
            )
            connection.execute(
                """
                UPDATE cards
                SET column_id = ?, position = ?
                WHERE board_id = ? AND id = ?
                """,
                (
                    destination_column_id,
                    temporary_position,
                    board_id,
                    card_id,
                ),
            )
            _assign_order(connection, board_id, source_column_id, source_ids)
            _assign_order(
                connection,
                board_id,
                destination_column_id,
                destination_ids,
            )

        return _read_board(connection, board_id)
