# Low-level design — Ralph loop update (Parts 11-13)

Companion to `docs/lld_design.md` and `docs/ralph_hld.md`. Where the original
LLD specifies the single-user/single-board MVP at the function-contract
level, this document specifies the same level of detail for what Parts 11-13
changed: real user accounts, multiple boards per user, and card labels.
Anything not mentioned here (card ordering algorithm, AI service internals,
Docker specifics) is unchanged from `docs/lld_design.md`.

## 1. Database schema diff

SQLite, now 6 tables, defined in `backend/database.py:SCHEMA_STATEMENTS`,
machine-readable copy in `docs/database-schema.json` (version 2).

```sql
users(id INTEGER PK, username TEXT UNIQUE NOT NULL CHECK(trim(username) != ''),
      password_hash TEXT NOT NULL)                      -- NEW column

boards(id INTEGER PK, user_id INTEGER NOT NULL,          -- UNIQUE dropped
       name TEXT NOT NULL CHECK(trim(name) != ''),       -- NEW column
       FK -> users.id ON DELETE CASCADE)

columns(...)   -- unchanged
cards(...)     -- unchanged

labels(board_id INTEGER, id TEXT, name TEXT NOT NULL, color TEXT NOT NULL,  -- NEW
       PK(board_id, id),
       CHECK(trim(name) != ''), CHECK(trim(color) != ''),
       FK(board_id) -> boards.id ON DELETE CASCADE)

card_labels(board_id INTEGER, card_id TEXT, label_id TEXT,                 -- NEW
            PK(board_id, card_id, label_id),
            FK(board_id, card_id)  -> cards(board_id, id)  ON DELETE CASCADE,
            FK(board_id, label_id) -> labels(board_id, id) ON DELETE CASCADE)
```

**Why `boards.user_id` lost its `UNIQUE` constraint**: that constraint *was*
the one-board-per-user invariant. Removing it is the entire schema-level
change needed for Part 12 — every other multi-board behavior (ownership
checks, listing, last-board guard) is enforced in `database.py`, not SQL.

**Seed behavior changed**: `_provision_user(connection, username,
password_hash, seed_demo_cards)` gained the `password_hash` and
`seed_demo_cards` parameters. `initialize_database()` calls it with
`seed_demo_cards=True` for the one hardcoded demo account (`MVP_USERNAME =
"user"`, `MVP_SEED_PASSWORD = "password"`, hashed like any other password).
Everything else — `register_user()`, `create_board()` — calls the shared
`_create_board(connection, user_id, name, seed_demo_cards)` helper with
`seed_demo_cards=False`, so a user's own boards always start with the five
fixed empty columns and zero cards.

## 2. Password hashing (`backend/database.py`)

```python
_HASH_ITERATIONS = 260_000

def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _HASH_ITERATIONS)
    return f"{_HASH_ITERATIONS}${salt.hex()}${digest.hex()}"

def verify_password(password: str, stored_hash: str) -> bool:
    iterations, salt_hex, digest_hex = stored_hash.split("$")   # ValueError -> False
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"),
                                     bytes.fromhex(salt_hex), int(iterations))
    return hmac.compare_digest(candidate, bytes.fromhex(digest_hex))
```

No new dependency — stdlib `hashlib`/`hmac`/`os` only. The iteration count is
embedded in the stored string (not just a config constant) so a future
increase doesn't invalidate already-stored hashes; `verify_password` reads
whatever iteration count was used at hash time. `hmac.compare_digest` is used
instead of `==` to avoid a timing side-channel on the comparison.

`register_user(database_path, username, password)`:

```python
def register_user(database_path, username, password):
    normalized = username.strip()
    if not normalized: raise ValueError("Username cannot be blank")
    if not password:   raise ValueError("Password cannot be blank")
    with closing(_connect(database_path)) as connection, connection:
        try:
            cursor = connection.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (normalized, hash_password(password)),
            )
        except sqlite3.IntegrityError as error:
            raise UsernameTakenError from error          # uq_users_username fired
        _create_board(connection, cursor.lastrowid, DEFAULT_BOARD_NAME, seed_demo_cards=False)
```

Deliberately **insert-then-catch** rather than select-then-insert: a
pre-check followed by a separate insert has a TOCTOU race under concurrent
registration of the same username; letting the `UNIQUE` constraint do the
work inside one transaction is both simpler and race-free.

`verify_login(database_path, username, password) -> bool`: one `SELECT
password_hash FROM users WHERE username = ?`; returns `False` immediately if
no row (no timing-safe placeholder comparison is done for unknown usernames —
accepted as out of scope for a local MVP with no rate-limiting anyway).

## 3. Board ownership resolution

The single invariant every Part 12 route depends on:

```python
def _resolve_board_id(connection, username, board_id) -> int:
    row = connection.execute(
        """SELECT boards.id FROM boards
           JOIN users ON users.id = boards.user_id
           WHERE users.username = ? AND boards.id = ?""",
        (username, board_id),
    ).fetchone()
    if row is None:
        raise BoardNotFoundError
    return int(row["id"])
```

Every board-scoped function (`get_board`, `rename_column`, `create_card`,
`edit_card`, `delete_card`, `move_card`, `apply_card_operations`,
`create_label`, `rename_label`, `delete_label`, `set_card_labels`,
`rename_board`, `delete_board`) calls this first, before touching any other
table. A `board_id` that exists but belongs to another user is
indistinguishable from one that doesn't exist — both raise
`BoardNotFoundError`, which `main.py` maps to a plain 404. This replaces the
old `_get_board_id(connection, username)` (username → the one board), which
no longer makes sense once a user can own more than one.

**Board lifecycle functions**:

```python
list_boards(database_path, username) -> list[{"id": int, "name": str}]
  # ORDER BY id — creation order, no separate `position` column needed since
  # boards aren't manually reordered.

create_board(database_path, username, name) -> {"id": int, "name": str}
  # Resolves user_id, then _create_board(..., seed_demo_cards=False).

rename_board(database_path, username, board_id, name) -> {"id": int, "name": str}
  # _resolve_board_id then UPDATE boards SET name = ?.

delete_board(database_path, username, board_id) -> list[{"id", "name"}]
  # _resolve_board_id, then COUNT(*) boards for this user_id;
  # <= 1 remaining -> raise LastBoardError (no delete attempted);
  # else DELETE and return the caller's remaining board list.
```

`delete_board` counts *before* resolving whether to delete, inside the same
transaction as the resolution/count/delete sequence, so the guard can never
race against a concurrent delete of the same user's last board (SQLite's
single-writer model serializes this automatically for the file-based DB used
here).

## 4. Label functions

```python
create_label(database_path, username, board_id, name, color) -> BoardResponse-shaped dict
  # INSERT INTO labels (board_id, id=f"label-{uuid4().hex}", name, color)

rename_label(database_path, username, board_id, label_id, name, color) -> dict
  # UPDATE ... WHERE board_id = ? AND id = ?; rowcount == 0 -> LabelNotFoundError

delete_label(database_path, username, board_id, label_id) -> dict
  # DELETE FROM labels WHERE board_id = ? AND id = ?; rowcount == 0 -> LabelNotFoundError
  # card_labels rows cascade via FK ON DELETE CASCADE — no manual cleanup needed

set_card_labels(database_path, username, board_id, card_id, label_ids) -> dict
  # 1. Verify the card exists on this board (CardNotFoundError otherwise).
  # 2. Dedupe label_ids (dict.fromkeys, order-preserving).
  # 3. If non-empty, COUNT(*) labels WHERE board_id = ? AND id IN (...) and
  #    compare to len(unique_ids); any mismatch -> LabelNotFoundError
  #    (validates the WHOLE set before writing anything).
  # 4. DELETE all existing card_labels rows for this card, then INSERT the
  #    new set — a full replace, not a diff/patch.
```

`set_card_labels` is intentionally a full-replace PUT rather than paired
add/remove endpoints: the frontend always knows the complete desired set
(current `labelIds` plus or minus one toggle) before calling it, so there's
one code path, one validation pass, and no ordering-dependent partial-failure
states to reason about.

`_read_board(connection, board_id)` (shared by every board-returning
function) was extended to also query `labels` (`ORDER BY name`) and
`card_labels`, attaching `labelIds: []` (then appended to) on each card entry
and a top-level `labels: [...]` catalog. This is the *only* place the label
shape enters the API surface — every existing caller of `_read_board`
automatically got the new fields for free.

## 5. Backend API contract diff

All board/column/card/label/chat routes moved from an implicit
single-board shape to `/api/boards/{board_id}/...`. The auth middleware's
gate condition collapsed from two prefixes to one:

```python
# before: path == "/api/board" or path.startswith("/api/board/")
#      or path == "/api/ai"    or path.startswith("/api/ai/")
# after:
is_protected = path == "/api/boards" or path.startswith("/api/boards/")
```

| Method | Path | Request body | Success | Failure |
|---|---|---|---|---|
| POST | `/api/auth/register` | `{username, password}` | `200`, sets `pm_session` cookie, `{authenticated:true, username}` | `409` username taken, `422` blank fields |
| GET | `/api/boards` | – | `200 [{id, name}, ...]` | `401` |
| POST | `/api/boards` | `{name}` | `201 {id, name}` | `401`, `422` |
| PATCH | `/api/boards/{board_id}` | `{name}` | `200 {id, name}` | `404` not owned, `422` |
| DELETE | `/api/boards/{board_id}` | – | `200 [{id, name}, ...]` (remaining) | `400` last board, `404` not owned |
| GET | `/api/boards/{board_id}` | – | `200` `BoardResponse` | `404` not owned |
| PATCH | `/api/boards/{board_id}/columns/{column_id}` | `{title}` | `200` board | `404`, `422` |
| POST | `/api/boards/{board_id}/cards` | `{columnId, title, details?}` | `201` board | `404`, `422` |
| PATCH \| DELETE | `/api/boards/{board_id}/cards/{card_id}` | `{title, details}` \| – | `200` board | `404`, `422` |
| POST | `/api/boards/{board_id}/cards/{card_id}/move` | `{columnId, position}` | `200` board | `404`, `400` out-of-range |
| PUT | `/api/boards/{board_id}/cards/{card_id}/labels` | `{labelIds: [...]}` | `200` board | `404` card or unknown label |
| POST | `/api/boards/{board_id}/labels` | `{name, color}` | `201` board | `404` board, `422` |
| PATCH \| DELETE | `/api/boards/{board_id}/labels/{label_id}` | `{name, color}` \| – | `200` board | `404` |
| POST | `/api/boards/{board_id}/ai/chat` | `{message, history[]}` | `200 {reply, boardChanged, board?}` | `404` board not owned, `422`, `503`, `502` |

`BoardResponse` shape (extended):

```json
{
  "columns": [{"id": "col-backlog", "title": "Backlog", "cardIds": ["card-1"]}],
  "cards": {"card-1": {"id": "card-1", "title": "...", "details": "...", "labelIds": ["label-abc"]}},
  "labels": [{"id": "label-abc", "name": "Urgent", "color": "#ecad0a"}]
}
```

### New request-model validation (`backend/main.py`)

| Field | Type alias | Rule |
|---|---|---|
| `username` (register) | `UsernameText` | trim, `1 ≤ len ≤ 60` |
| `password` (register) | `PasswordText` | `1 ≤ len ≤ 200`, not trimmed |
| Board `name` (create/rename) | `BoardNameText` | trim, `1 ≤ len ≤ 100` |
| Label `name` (create/rename) | `LabelNameText` | trim, `1 ≤ len ≤ 40` |
| Label `color` (create/rename) | `LabelColorText` | trim, `1 ≤ len ≤ 20`, no format check |
| `labelIds` (set card labels) | `list[NonBlankText]` | each entry non-blank; empty list allowed (clears all labels) |

### Error mapping additions

| Exception | Status | Detail |
|---|---|---|
| `LabelNotFoundError` | 404 | "Label not found" |
| `LastBoardError` | 400 | "Cannot delete your only board" |
| `UsernameTakenError` | 409 | "Username is already taken" |

## 6. Session/auth internals diff (`backend/main.py`)

`login()` no longer compares against `MVP_USERNAME`/`MVP_PASSWORD`
constants (removed). It calls `verify_login(db_path, username, password)`
and, on `True`, calls the shared `_start_session(username, response)` helper
— the same helper `register()` calls after a successful `register_user()`.
Factoring session-start into one function means "log a user in" has exactly
one implementation regardless of whether they just registered or are
returning.

```python
def _start_session(username: str, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    active_sessions[token] = (username, time.time() + SESSION_MAX_AGE)
    response.set_cookie(key=SESSION_COOKIE, value=token, max_age=SESSION_MAX_AGE,
                         httponly=True, samesite="lax", secure=False, path="/")
```

Everything else in §6 of `docs/lld_design.md` (`_resolve_session`, lazy
expiry, logout, process-memory-only store) is unchanged.

## 7. Frontend module contracts diff

### `lib/kanban.ts` (types, pure — no React/fetch)

```ts
type Card = { id: string; title: string; details: string; labelIds: string[] }  // + labelIds
type Label = { id: string; name: string; color: string }                        // NEW
type BoardData = { columns: Column[]; cards: Record<string, Card>; labels: Label[] } // + labels
type BoardSummary = { id: number; name: string }                                // NEW
const MAX_LABEL_NAME_LENGTH = 40   // NEW
const MAX_BOARD_NAME_LENGTH = 100  // NEW
```

`moveCard` / `getCardDestination` are unchanged — they operate on
`columns`/card IDs only and never touch labels or board identity.

### `lib/api.ts`

```ts
sessionApi.register(username, password): Promise<SessionPayload>
  // POST /api/auth/register

boardsApi.list(): Promise<BoardSummary[]>
boardsApi.create(name): Promise<BoardSummary>
boardsApi.rename(boardId, name): Promise<BoardSummary>
boardsApi.delete(boardId): Promise<BoardSummary[]>

boardApi.get(boardId)                                  // was boardApi.get()
boardApi.renameColumn(boardId, columnId, title)         // boardId added
boardApi.createCard(boardId, columnId, title, details)  // boardId added
boardApi.editCard(boardId, cardId, title, details)      // boardId added
boardApi.deleteCard(boardId, cardId)                    // boardId added
boardApi.moveCard(boardId, cardId, columnId, position)  // boardId added
boardApi.setCardLabels(boardId, cardId, labelIds): Promise<BoardData>     // NEW
boardApi.createLabel(boardId, name, color): Promise<BoardData>           // NEW
boardApi.renameLabel(boardId, labelId, name, color): Promise<BoardData>  // NEW
boardApi.deleteLabel(boardId, labelId): Promise<BoardData>               // NEW

chatApi.send(boardId, message, history)                 // boardId added
```

Every `boardApi`/`chatApi` function gained a leading `boardId: number`
parameter and builds `/api/boards/${boardId}/...` instead of `/api/board/...`.
`request()` itself (the shared fetch wrapper: `credentials: "same-origin"`,
JSON-or-fallback-`undefined` body parsing, `ApiError` on non-2xx) is
unchanged.

### `KanbanBoard.tsx` — state and data flow diff

```ts
type WorkspaceLoadResult =                                    // was BoardLoadResult
  | { outcome: "success"; boards: BoardSummary[]; board: BoardData }  // + boards
  | { outcome: "unauthorized" }
  | { outcome: "error" }

fetchWorkspaceResult(): Promise<WorkspaceLoadResult>
  // boardsApi.list() then boardApi.get(boards[0].id) — two sequential
  // awaits, both wrapped in the same try/catch so a 401 from either fetch
  // is classified identically.
```

New component state: `boards: BoardSummary[]`, `selectedBoardId: number |
null` (alongside the pre-existing `board: BoardData | null`). `switchBoard
(boardId)` re-fetches only `boardApi.get(boardId)` — the boards list itself
doesn't change on a switch, only the detail view. Every existing
`handle*` mutation function (`handleRenameColumn`, `handleAddCard`, etc.)
gained a `selectedBoardId` guard (`return Promise.resolve(false)` if null —
can't happen once loaded, but keeps the functions total) and now passes
`selectedBoardId` as the leading argument to its `boardApi` call.

New handlers, all following the same `runMutation`-or-equivalent
try/401/error pattern as the rest of the component:

```ts
handleToggleLabel(cardId, labelId, assign): Promise<boolean>
  // Reads board.cards[cardId].labelIds, computes the next array
  // (push or filter), calls boardApi.setCardLabels(selectedBoardId, cardId, next).

handleCreateLabel(name, color) / handleRenameLabel(id, name, color) / handleDeleteLabel(id)
  // Thin wrappers around the matching boardApi.*Label calls.

handleCreateBoard(name): Promise<boolean>
  // boardsApi.create(name) -> append to `boards` state -> switchBoard(created.id).
  // Runs its own in-flight guard (mutationInFlight.current) separately from
  // runMutation because it mutates `boards`, not `board`.

handleRenameBoard(boardId, name) / handleDeleteBoard(boardId): Promise<boolean>
  // Update `boards` state from the response; handleDeleteBoard additionally
  // switches to the first remaining board if the deleted one was selected,
  // and maps a 400 ApiError to the "You cannot delete your only board."
  // mutationError message specifically (other statuses get the generic one).
```

### `BoardSwitcher.tsx` (new component)

Props: `boards: BoardSummary[]`, `selectedBoardId: number`, `isDisabled:
boolean`, `onSwitch/onCreate/onRename/onDelete`. Purely presentational —
holds only its own transient form-open/text-input state; every action
delegates to the callback props. Delete calls `window.confirm(...)` before
invoking `onDelete`, and the button is `disabled={... || boards.length <=
1}` so the last-board guard is enforced both client-side (UX) and
server-side (`LastBoardError`, in case of a stale `boards.length` reading).

### `LabelManager.tsx` (new component)

Props: `labels: Label[]`, `isDisabled`, `onCreate/onRename/onDelete`. A fixed
6-color palette (`#ecad0a #209dd7 #753991 #032147 #16a085 #f26b5b` — the
project's existing accent colors plus two extras) is offered as swatch
buttons rather than a free-form color picker, keeping label colors visually
consistent with the rest of the UI. Clicking a label chip's name/dot opens an
inline rename form in place; there is no separate "labels" page/route.

### `KanbanCard.tsx` diff

New props: `labels: Label[]` (the full board catalog — needed to render
chips and populate the picker) and `onToggleLabel`. New local state
`isLabelMenuOpen`. Non-editing render gained:

1. A row of colored chips above the title, computed as
   `labels.filter(l => card.labelIds.includes(l.id))` — i.e. the card only
   stores IDs, the component resolves them against the catalog at render
   time (no denormalized name/color stored on the card row).
2. A tag-icon button (`aria-expanded={isLabelMenuOpen}`) that toggles a small
   absolutely-positioned dropdown of checkboxes, one per board label, each
   wired to `onChange={() => onToggleLabel(card.id, label.id, !isAssigned)}`.

`KanbanCardPreview.tsx` (the `DragOverlay` presentation component) gained the
same `labels` prop and chip-rendering logic so a card being dragged shows its
labels too — it does not need `onToggleLabel` since the overlay isn't
interactive.

### `AuthApp.tsx` / `LoginForm` diff

`LoginForm` gained a `mode: "login" | "register"` state and a
`role="tablist"` pair of buttons to switch it. `handleSubmit` branches on
`mode` to call `sessionApi.login` or `sessionApi.register`; error handling
branches similarly (`401` → "Invalid username or password." only in login
mode, `409` → "That username is already taken." only in register mode). On
success, `onSignedIn(session.username)` is called identically regardless of
mode — the parent `AuthApp` doesn't need to know how the user got
authenticated.

## 8. Test-to-code map (additions)

| Behavior | Backend test | Frontend test |
|---|---|---|
| Registration (success, duplicate, blank) | `test_app.py` (`test_register_*`), `test_database.py` (`test_register_user_*`) | `AuthApp.test.tsx` |
| DB-backed login replaces hardcoded check | `test_app.py::test_registered_user_cannot_use_the_seed_password` | `api.test.ts` (`sessionApi.register`) |
| Board CRUD + last-board guard | `test_app.py` (`test_create_rename_and_delete_board`, `test_cannot_delete_the_last_remaining_board`), `test_database.py` | `KanbanBoard.test.tsx` (create/switch), `tests/kanban.spec.ts` |
| Cross-user board/label 404s | `test_app.py::test_board_routes_reject_another_users_board_id`, `test_chat.py::test_chat_rejects_another_users_board`, `test_database.py::test_board_operations_reject_another_users_board_id` | – |
| Label CRUD + card assignment | `test_app.py::test_create_rename_delete_label_and_assign_to_card`, `test_database.py::test_label_lifecycle_and_card_assignment` | `KanbanBoard.test.tsx`, `tests/kanban.spec.ts` (label test) |
| Label scoping to its board | `test_app.py::test_labels_are_scoped_to_their_board` | – |
| Unknown label assignment rejected | `test_app.py::test_assigning_an_unknown_label_is_rejected`, `test_database.py::test_assigning_unknown_label_is_rejected` | – |
| Chat scoped to one board | `test_chat.py` (all cases updated to a `board_id`-scoped route) | `KanbanBoard.test.tsx` (chat cases) |
| Full user journeys incl. multi-board + labels | – | `tests/kanban.spec.ts` (Playwright, mocked `/api/**`, board-aware route dispatch) |

## 9. Deployment specifics diff

None — `Dockerfile`/`compose.yaml`/entrypoint script are unchanged from
`docs/lld_design.md` §9. The only operational change is that a `pm-data`
volume created before this iteration has the old schema (no
`password_hash`, unique `boards.user_id`, no `labels`/`card_labels` tables)
and will fail `initialize_database()` with `sqlite3.OperationalError: table
users has no column named password_hash`. There is no migration path by
design (see `docs/ralph_hld.md` §"Key design decisions"); resetting the
volume (`docker compose down -v`) is the expected recovery for local/dev use.
