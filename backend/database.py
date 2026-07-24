from collections.abc import Mapping, Sequence
from contextlib import closing
import hashlib
import hmac
import os
from pathlib import Path
import sqlite3
from uuid import uuid4


MVP_USERNAME = "user"
MVP_SEED_PASSWORD = "password"
DEFAULT_BOARD_NAME = "My Board"

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
        password_hash TEXT NOT NULL,
        CONSTRAINT uq_users_username UNIQUE (username),
        CONSTRAINT ck_users_username_not_blank
            CHECK (length(trim(username)) > 0)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS boards (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        CONSTRAINT ck_boards_name_not_blank
            CHECK (length(trim(name)) > 0),
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
    """
    CREATE TABLE IF NOT EXISTS labels (
        board_id INTEGER NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        PRIMARY KEY (board_id, id),
        CONSTRAINT ck_labels_name_not_blank
            CHECK (length(trim(name)) > 0),
        CONSTRAINT ck_labels_color_not_blank
            CHECK (length(trim(color)) > 0),
        FOREIGN KEY (board_id) REFERENCES boards (id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS card_labels (
        board_id INTEGER NOT NULL,
        card_id TEXT NOT NULL,
        label_id TEXT NOT NULL,
        PRIMARY KEY (board_id, card_id, label_id),
        FOREIGN KEY (board_id, card_id)
            REFERENCES cards (board_id, id) ON DELETE CASCADE,
        FOREIGN KEY (board_id, label_id)
            REFERENCES labels (board_id, id) ON DELETE CASCADE
    )
    """,
)


class BoardNotFoundError(Exception):
    pass


class ColumnNotFoundError(Exception):
    pass


class CardNotFoundError(Exception):
    pass


class LabelNotFoundError(Exception):
    pass


class InvalidMoveError(Exception):
    pass


class InvalidCardOperationError(Exception):
    pass


class UsernameTakenError(Exception):
    pass


class LastBoardError(Exception):
    pass


CONNECTION_TIMEOUT_SECONDS = 10.0
_HASH_ITERATIONS = 260_000


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, _HASH_ITERATIONS
    )
    return f"{_HASH_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        iterations_text, salt_hex, digest_hex = stored_hash.split("$")
        iterations = int(iterations_text)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except ValueError:
        return False
    candidate = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, iterations
    )
    return hmac.compare_digest(candidate, expected)


def _connect(database_path: str | Path) -> sqlite3.Connection:
    connection = sqlite3.connect(database_path, timeout=CONNECTION_TIMEOUT_SECONDS)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


def initialize_database(database_path: str | Path) -> None:
    path = Path(database_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with closing(_connect(path)) as connection, connection:
        for statement in SCHEMA_STATEMENTS:
            connection.execute(statement)
        _provision_user(
            connection,
            MVP_USERNAME,
            hash_password(MVP_SEED_PASSWORD),
            seed_demo_cards=True,
        )


def provision_user(
    database_path: str | Path,
    username: str,
    password: str = MVP_SEED_PASSWORD,
) -> None:
    with closing(_connect(database_path)) as connection, connection:
        _provision_user(
            connection, username, hash_password(password), seed_demo_cards=True
        )


def _provision_user(
    connection: sqlite3.Connection,
    username: str,
    password_hash: str,
    seed_demo_cards: bool,
) -> None:
    normalized_username = username.strip()
    if not normalized_username:
        raise ValueError("Username cannot be blank")

    connection.execute(
        "INSERT OR IGNORE INTO users (username, password_hash) VALUES (?, ?)",
        (normalized_username, password_hash),
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

    _create_board(connection, user_row["id"], DEFAULT_BOARD_NAME, seed_demo_cards)


def register_user(database_path: str | Path, username: str, password: str) -> None:
    normalized_username = username.strip()
    if not normalized_username:
        raise ValueError("Username cannot be blank")
    if not password:
        raise ValueError("Password cannot be blank")

    with closing(_connect(database_path)) as connection, connection:
        try:
            cursor = connection.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (normalized_username, hash_password(password)),
            )
        except sqlite3.IntegrityError as error:
            raise UsernameTakenError from error
        user_id = cursor.lastrowid
        _create_board(connection, user_id, DEFAULT_BOARD_NAME, seed_demo_cards=False)


def verify_login(database_path: str | Path, username: str, password: str) -> bool:
    with closing(_connect(database_path)) as connection:
        row = connection.execute(
            "SELECT password_hash FROM users WHERE username = ?",
            (username,),
        ).fetchone()
    if row is None:
        return False
    return verify_password(password, row["password_hash"])


def _create_board(
    connection: sqlite3.Connection,
    user_id: int,
    name: str,
    seed_demo_cards: bool,
) -> int:
    cursor = connection.execute(
        "INSERT INTO boards (user_id, name) VALUES (?, ?)",
        (user_id, name),
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
    if seed_demo_cards:
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
    return board_id


def list_boards(
    database_path: str | Path,
    username: str,
) -> list[dict[str, object]]:
    with closing(_connect(database_path)) as connection:
        user_row = connection.execute(
            "SELECT id FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        if user_row is None:
            raise BoardNotFoundError
        rows = connection.execute(
            "SELECT id, name FROM boards WHERE user_id = ? ORDER BY id",
            (user_row["id"],),
        ).fetchall()
    return [{"id": row["id"], "name": row["name"]} for row in rows]


def create_board(
    database_path: str | Path,
    username: str,
    name: str,
) -> dict[str, object]:
    with closing(_connect(database_path)) as connection, connection:
        user_row = connection.execute(
            "SELECT id FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        if user_row is None:
            raise BoardNotFoundError
        board_id = _create_board(
            connection, user_row["id"], name, seed_demo_cards=False
        )
        return {"id": board_id, "name": name}


def rename_board(
    database_path: str | Path,
    username: str,
    board_id: int,
    name: str,
) -> dict[str, object]:
    with closing(_connect(database_path)) as connection, connection:
        owned_board_id = _resolve_board_id(connection, username, board_id)
        connection.execute(
            "UPDATE boards SET name = ? WHERE id = ?",
            (name, owned_board_id),
        )
        return {"id": owned_board_id, "name": name}


def delete_board(
    database_path: str | Path,
    username: str,
    board_id: int,
) -> list[dict[str, object]]:
    with closing(_connect(database_path)) as connection, connection:
        user_row = connection.execute(
            "SELECT id FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        if user_row is None:
            raise BoardNotFoundError
        owned_board_id = _resolve_board_id(connection, username, board_id)
        remaining = connection.execute(
            "SELECT count(*) AS count FROM boards WHERE user_id = ?",
            (user_row["id"],),
        ).fetchone()["count"]
        if remaining <= 1:
            raise LastBoardError

        connection.execute("DELETE FROM boards WHERE id = ?", (owned_board_id,))
        rows = connection.execute(
            "SELECT id, name FROM boards WHERE user_id = ? ORDER BY id",
            (user_row["id"],),
        ).fetchall()
        return [{"id": row["id"], "name": row["name"]} for row in rows]


def _resolve_board_id(
    connection: sqlite3.Connection,
    username: str,
    board_id: int,
) -> int:
    row = connection.execute(
        """
        SELECT boards.id
        FROM boards
        JOIN users ON users.id = boards.user_id
        WHERE users.username = ? AND boards.id = ?
        """,
        (username, board_id),
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
    label_rows = connection.execute(
        """
        SELECT id, name, color
        FROM labels
        WHERE board_id = ?
        ORDER BY name
        """,
        (board_id,),
    ).fetchall()
    card_label_rows = connection.execute(
        """
        SELECT card_id, label_id
        FROM card_labels
        WHERE board_id = ?
        ORDER BY label_id
        """,
        (board_id,),
    ).fetchall()

    card_ids_by_column = {row["id"]: [] for row in column_rows}
    cards: dict[str, dict[str, object]] = {}
    for row in card_rows:
        card_ids_by_column[row["column_id"]].append(row["id"])
        cards[row["id"]] = {
            "id": row["id"],
            "title": row["title"],
            "details": row["details"],
            "labelIds": [],
        }
    for row in card_label_rows:
        card = cards.get(row["card_id"])
        if card is not None:
            card["labelIds"].append(row["label_id"])

    columns = [
        {
            "id": row["id"],
            "title": row["title"],
            "cardIds": card_ids_by_column[row["id"]],
        }
        for row in column_rows
    ]
    labels = [
        {"id": row["id"], "name": row["name"], "color": row["color"]}
        for row in label_rows
    ]
    return {"columns": columns, "cards": cards, "labels": labels}


def get_board(
    database_path: str | Path,
    username: str,
    board_id: int,
) -> dict[str, object]:
    with closing(_connect(database_path)) as connection:
        owned_board_id = _resolve_board_id(connection, username, board_id)
        return _read_board(connection, owned_board_id)


def rename_column(
    database_path: str | Path,
    username: str,
    board_id: int,
    column_id: str,
    title: str,
) -> dict[str, object]:
    with closing(_connect(database_path)) as connection, connection:
        owned_board_id = _resolve_board_id(connection, username, board_id)
        cursor = connection.execute(
            """
            UPDATE columns
            SET title = ?
            WHERE board_id = ? AND id = ?
            """,
            (title, owned_board_id, column_id),
        )
        if cursor.rowcount == 0:
            raise ColumnNotFoundError
        return _read_board(connection, owned_board_id)


def _create_card(
    connection: sqlite3.Connection,
    board_id: int,
    column_id: str,
    title: str,
    details: str,
) -> None:
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


def create_card(
    database_path: str | Path,
    username: str,
    board_id: int,
    column_id: str,
    title: str,
    details: str,
) -> dict[str, object]:
    with closing(_connect(database_path)) as connection, connection:
        owned_board_id = _resolve_board_id(connection, username, board_id)
        _create_card(connection, owned_board_id, column_id, title, details)
        return _read_board(connection, owned_board_id)


def _edit_card(
    connection: sqlite3.Connection,
    board_id: int,
    card_id: str,
    title: str,
    details: str,
) -> None:
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


def edit_card(
    database_path: str | Path,
    username: str,
    board_id: int,
    card_id: str,
    title: str,
    details: str,
) -> dict[str, object]:
    with closing(_connect(database_path)) as connection, connection:
        owned_board_id = _resolve_board_id(connection, username, board_id)
        _edit_card(connection, owned_board_id, card_id, title, details)
        return _read_board(connection, owned_board_id)


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
    board_id: int,
    card_id: str,
) -> dict[str, object]:
    with closing(_connect(database_path)) as connection, connection:
        owned_board_id = _resolve_board_id(connection, username, board_id)
        card = connection.execute(
            """
            SELECT column_id
            FROM cards
            WHERE board_id = ? AND id = ?
            """,
            (owned_board_id, card_id),
        ).fetchone()
        if card is None:
            raise CardNotFoundError

        column_id = card["column_id"]
        connection.execute(
            "DELETE FROM cards WHERE board_id = ? AND id = ?",
            (owned_board_id, card_id),
        )
        remaining_ids = _card_ids(connection, owned_board_id, column_id)
        _stage_columns(connection, owned_board_id, (column_id,))
        _assign_order(connection, owned_board_id, column_id, remaining_ids)
        return _read_board(connection, owned_board_id)


def _move_card(
    connection: sqlite3.Connection,
    board_id: int,
    card_id: str,
    destination_column_id: str,
    destination_position: int,
) -> None:
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


def move_card(
    database_path: str | Path,
    username: str,
    board_id: int,
    card_id: str,
    destination_column_id: str,
    destination_position: int,
) -> dict[str, object]:
    with closing(_connect(database_path)) as connection, connection:
        owned_board_id = _resolve_board_id(connection, username, board_id)
        _move_card(
            connection,
            owned_board_id,
            card_id,
            destination_column_id,
            destination_position,
        )
        return _read_board(connection, owned_board_id)


def create_label(
    database_path: str | Path,
    username: str,
    board_id: int,
    name: str,
    color: str,
) -> dict[str, object]:
    with closing(_connect(database_path)) as connection, connection:
        owned_board_id = _resolve_board_id(connection, username, board_id)
        label_id = f"label-{uuid4().hex}"
        connection.execute(
            "INSERT INTO labels (board_id, id, name, color) VALUES (?, ?, ?, ?)",
            (owned_board_id, label_id, name, color),
        )
        return _read_board(connection, owned_board_id)


def rename_label(
    database_path: str | Path,
    username: str,
    board_id: int,
    label_id: str,
    name: str,
    color: str,
) -> dict[str, object]:
    with closing(_connect(database_path)) as connection, connection:
        owned_board_id = _resolve_board_id(connection, username, board_id)
        cursor = connection.execute(
            """
            UPDATE labels
            SET name = ?, color = ?
            WHERE board_id = ? AND id = ?
            """,
            (name, color, owned_board_id, label_id),
        )
        if cursor.rowcount == 0:
            raise LabelNotFoundError
        return _read_board(connection, owned_board_id)


def delete_label(
    database_path: str | Path,
    username: str,
    board_id: int,
    label_id: str,
) -> dict[str, object]:
    with closing(_connect(database_path)) as connection, connection:
        owned_board_id = _resolve_board_id(connection, username, board_id)
        cursor = connection.execute(
            "DELETE FROM labels WHERE board_id = ? AND id = ?",
            (owned_board_id, label_id),
        )
        if cursor.rowcount == 0:
            raise LabelNotFoundError
        return _read_board(connection, owned_board_id)


def set_card_labels(
    database_path: str | Path,
    username: str,
    board_id: int,
    card_id: str,
    label_ids: Sequence[str],
) -> dict[str, object]:
    with closing(_connect(database_path)) as connection, connection:
        owned_board_id = _resolve_board_id(connection, username, board_id)
        card = connection.execute(
            "SELECT 1 FROM cards WHERE board_id = ? AND id = ?",
            (owned_board_id, card_id),
        ).fetchone()
        if card is None:
            raise CardNotFoundError

        unique_label_ids = list(dict.fromkeys(label_ids))
        if unique_label_ids:
            placeholders = ", ".join("?" for _ in unique_label_ids)
            valid_count = connection.execute(
                f"""
                SELECT count(*) AS count
                FROM labels
                WHERE board_id = ? AND id IN ({placeholders})
                """,
                (owned_board_id, *unique_label_ids),
            ).fetchone()["count"]
            if valid_count != len(unique_label_ids):
                raise LabelNotFoundError

        connection.execute(
            "DELETE FROM card_labels WHERE board_id = ? AND card_id = ?",
            (owned_board_id, card_id),
        )
        connection.executemany(
            """
            INSERT INTO card_labels (board_id, card_id, label_id)
            VALUES (?, ?, ?)
            """,
            (
                (owned_board_id, card_id, label_id)
                for label_id in unique_label_ids
            ),
        )
        return _read_board(connection, owned_board_id)


def _validate_card_operations(
    board: dict[str, object],
    operations: Sequence[Mapping[str, object]],
) -> None:
    column_cards = {
        column["id"]: list(column["cardIds"])
        for column in board["columns"]
    }
    card_columns = {
        card_id: column_id
        for column_id, card_ids in column_cards.items()
        for card_id in card_ids
    }

    for index, operation in enumerate(operations):
        operation_type = operation.get("type")
        if operation_type == "create_card":
            column_id = operation["column_id"]
            if column_id not in column_cards:
                raise ColumnNotFoundError
            placeholder_id = f"new-card-{index}"
            column_cards[column_id].append(placeholder_id)
            card_columns[placeholder_id] = column_id
        elif operation_type == "edit_card":
            if operation["card_id"] not in card_columns:
                raise CardNotFoundError
        elif operation_type == "move_card":
            card_id = operation["card_id"]
            destination_column_id = operation["column_id"]
            destination_position = operation["position"]
            if card_id not in card_columns:
                raise CardNotFoundError
            if destination_column_id not in column_cards:
                raise ColumnNotFoundError

            source_column_id = card_columns[card_id]
            column_cards[source_column_id].remove(card_id)
            destination_ids = column_cards[destination_column_id]
            if destination_position > len(destination_ids):
                raise InvalidMoveError
            destination_ids.insert(destination_position, card_id)
            card_columns[card_id] = destination_column_id
        else:
            raise InvalidCardOperationError


def apply_card_operations(
    database_path: str | Path,
    username: str,
    board_id: int,
    operations: Sequence[Mapping[str, object]],
) -> dict[str, object]:
    with closing(_connect(database_path)) as connection, connection:
        owned_board_id = _resolve_board_id(connection, username, board_id)
        _validate_card_operations(
            _read_board(connection, owned_board_id), operations
        )

        for operation in operations:
            operation_type = operation["type"]
            if operation_type == "create_card":
                _create_card(
                    connection,
                    owned_board_id,
                    operation["column_id"],
                    operation["title"],
                    operation["details"],
                )
            elif operation_type == "edit_card":
                _edit_card(
                    connection,
                    owned_board_id,
                    operation["card_id"],
                    operation["title"],
                    operation["details"],
                )
            else:
                _move_card(
                    connection,
                    owned_board_id,
                    operation["card_id"],
                    operation["column_id"],
                    operation["position"],
                )

        return _read_board(connection, owned_board_id)
