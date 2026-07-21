# Low-level design

Companion to `docs/hld_design.md`. Where the HLD explains the shape of the system, this document specifies the actual data structures, function contracts, algorithms, and validation rules — the level of detail needed to modify the code correctly. Line/function references are to the state of the repo after `docs/code_review.md`'s remediation.

## 1. Database schema

SQLite, 4 tables, defined in `backend/database.py:SCHEMA_STATEMENTS`, machine-readable copy in `docs/database-schema.json`.

```sql
users(id INTEGER PK, username TEXT UNIQUE NOT NULL CHECK(trim(username) != ''))

boards(id INTEGER PK, user_id INTEGER UNIQUE NOT NULL
       FK -> users.id ON DELETE CASCADE)

columns(board_id INTEGER, id TEXT, position INTEGER, title TEXT NOT NULL,
        PK(board_id, id),
        UNIQUE(board_id, position),
        CHECK(position >= 0 AND position < 5),
        CHECK(trim(title) != ''),
        FK(board_id) -> boards.id ON DELETE CASCADE)

cards(board_id INTEGER, id TEXT, column_id TEXT, position INTEGER,
      title TEXT NOT NULL, details TEXT NOT NULL DEFAULT '',
      PK(board_id, id),
      UNIQUE(board_id, column_id, position),
      CHECK(position >= 0),
      CHECK(trim(title) != ''),
      FK(board_id) -> boards.id ON DELETE CASCADE,
      FK(board_id, column_id) -> columns(board_id, id) ON DELETE CASCADE)
```

**Fixed seed data** (`DEFAULT_COLUMNS`, `DEFAULT_CARDS` in `database.py`): column IDs `col-backlog` / `col-discovery` / `col-progress` / `col-review` / `col-done` at positions 0–4, and 8 demo cards. Seeded once per user by `_provision_user()`, which is idempotent — it checks for an existing board before inserting anything, so a restart never reseeds or overwrites live data.

**Connection settings** (`_connect()`): `sqlite3.connect(path, timeout=CONNECTION_TIMEOUT_SECONDS)` where `CONNECTION_TIMEOUT_SECONDS = 10.0`; `PRAGMA foreign_keys = ON`; `PRAGMA journal_mode = WAL`; `row_factory = sqlite3.Row`. Every public function in `database.py` opens its own connection via `closing(_connect(path))` and, for writes, uses the connection itself as a context manager (`with ... , connection:`) so the transaction commits on success and rolls back on any exception.

## 2. Card ordering algorithm

Positions are zero-based and contiguous per column after every committed mutation. The tricky part is rewriting positions without transiently violating the `UNIQUE(board_id, column_id, position)` constraint, since you can't set two rows to the same position even mid-transaction.

**`_stage_columns(connection, board_id, column_ids)`** — moves every card currently in the given column(s) to a temporary, non-colliding "high" position range:

```
max_position = MAX(position) over the given columns (or -1 if empty)
total_cards  = COUNT(*) over the given columns
offset       = max_position + total_cards + 2
UPDATE cards SET position = position + offset WHERE column_id IN (...)
return offset + max_position + 1   # one free slot just above the staged range
```

Because the staged range `[offset, offset + max_position]` is entirely above any position that will be assigned next (`[0, total_cards - 1]`), reassigning final positions one row at a time afterward can never collide with a row that hasn't been reassigned yet.

**`_assign_order(connection, board_id, column_id, card_ids)`** — writes final `0..n-1` positions for `card_ids` in that exact order, one `UPDATE` per card.

**Same-column reorder** (`_move_card`, same source/destination): stage the one column, remove the card from the in-memory id list, re-insert at the destination index, reassign.

**Cross-column move**: stage *both* columns together (one shared offset, computed from their combined stats — safe but slightly conservative since the uniqueness constraint is actually per-column), move the card to the destination column at the free temporary slot returned by `_stage_columns`, then reassign both columns' final orders. The temporary slot write and the two reassign passes are all inside the same transaction.

**Delete**: remove the row, then stage + reassign the one affected column to close the gap.

This same staging pattern backs `create_card` (no staging needed — new card just gets `position = COUNT(*)`, i.e. appended), `delete_card`, `move_card`, and is reused unmodified by the AI operation batch applier.

## 3. AI operation batch application

`apply_card_operations(database_path, username, operations)` in `database.py`:

1. Open one connection/transaction for the whole batch.
2. `_validate_card_operations(board, operations)` — replays every operation against an **in-memory copy** of `{column_id: [card_ids]}` / `{card_id: column_id}` derived from a fresh `_read_board()`. A `create_card` op gets a placeholder id (`new-card-{index}`) purely so later validation logic has something to reference; the model is never told this ID and is instructed not to invent IDs. Any lookup failure raises immediately (`ColumnNotFoundError` / `CardNotFoundError` / `InvalidMoveError` / `InvalidCardOperationError`) **before any row is written**.
3. Only after full-batch validation passes does the function loop again and actually execute each operation (`_create_card` / `_edit_card` / `_move_card`).
4. Any exception during execution propagates out of the `with connection:` block, which rolls back the whole transaction — so a batch is genuinely all-or-nothing, not just "validated then hope."

Operation shape (validated twice — once by Pydantic via `chat.py:CardOperation`, once again here structurally):

| type | required fields (others must be `null`) |
|---|---|
| `create_card` | `column_id`, `title`, `details` |
| `edit_card` | `card_id`, `title`, `details` |
| `move_card` | `card_id`, `column_id`, `position` |

## 4. Backend API contract

All routes mounted under `/api` (see `backend/main.py`). Auth is enforced by one middleware (`protect_authenticated_api`) gating any path matching `/api/board*` or `/api/ai*`; `/api/health` and `/api/auth/*` are public.

| Method | Path | Auth | Request body | Success | Failure |
|---|---|---|---|---|---|
| GET | `/api/health` | none | – | `200 {"status":"ok"}` | – |
| POST | `/api/auth/login` | none | `{username, password}` | `200`, sets `pm_session` cookie | `401` invalid credentials |
| GET | `/api/auth/session` | cookie optional | – | `200 {authenticated, username?}` | `401` if cookie present but invalid/expired |
| POST | `/api/auth/logout` | none | – | `200`, clears cookie | – |
| GET | `/api/board` | required | – | `200` `BoardResponse` | `401` |
| PATCH | `/api/board/columns/{id}` | required | `{title}` | `200` board | `404` unknown column, `422` blank/oversized title |
| POST | `/api/board/cards` | required | `{columnId, title, details?}` | `201` board | `404` unknown column, `422` validation |
| PATCH | `/api/board/cards/{id}` | required | `{title, details}` | `200` board | `404` unknown card, `422` validation |
| DELETE | `/api/board/cards/{id}` | required | – | `200` board | `404` unknown card |
| POST | `/api/board/cards/{id}/move` | required | `{columnId, position}` | `200` board | `404` unknown card/column, `400` out-of-range position |
| POST | `/api/ai/chat` | required | `{message, history[]}` | `200 {reply, boardChanged, board?}` | `422` bad input, `503` AI not configured, `502` provider or invalid-operation failure |

`BoardResponse` shape (also what `board` is in the chat response):

```json
{
  "columns": [{"id": "col-backlog", "title": "Backlog", "cardIds": ["card-1", "card-2"]}],
  "cards": {"card-1": {"id": "card-1", "title": "...", "details": "..."}}
}
```

Every route returns this canonical shape (not a partial patch), so the frontend can always replace its entire visible state with the response and never has to merge.

### Request-model validation (`backend/main.py`)

| Field | Type alias | Rule |
|---|---|---|
| Column `title` (rename) | `TitleText` | trim, `1 ≤ len ≤ 200` |
| Card `title` (create/edit) | `TitleText` | trim, `1 ≤ len ≤ 200` |
| Card `details` (create/edit) | `DetailsText` | `len ≤ 4000`, not trimmed, blank allowed |
| `columnId` path/body | `NonBlankText` | trim, `len ≥ 1`, no upper bound |
| Move `position` | `NonNegativePosition` | strict int, `≥ 0` |
| Chat `message` / history `content` | `ChatText` | trim, `1 ≤ len ≤ MAX_MESSAGE_LENGTH (2000)` |
| Chat `history` | – | `≤ MAX_HISTORY_MESSAGES (20)` entries, role ∈ `{user, assistant}` |

`MAX_CARD_TITLE_LENGTH` (200) / `MAX_CARD_DETAILS_LENGTH` (4000) are defined once in `backend/chat.py` and imported into `main.py`, so the manual-API limits and the AI-operation limits ( §5 ) are guaranteed identical rather than maintained in two places.

### Error mapping

FastAPI exception handlers registered on the `api` sub-app translate internal exceptions to a uniform `{"detail": "..."}` body:

| Exception | Status | Detail |
|---|---|---|
| `BoardNotFoundError` | 404 | "Board not found" |
| `ColumnNotFoundError` | 404 | "Column not found" |
| `CardNotFoundError` | 404 | "Card not found" |
| `InvalidMoveError` | 400 | "Invalid destination position" |
| `sqlite3.OperationalError` | 503 | "The board is busy. Please try again." |
| Pydantic validation | 422 | FastAPI's default field-error shape |

## 5. AI chat internals (`backend/chat.py`, `backend/ai.py`)

**`StructuredChatResponse`** (the OpenAI Structured Outputs schema, `model_config = ConfigDict(extra="forbid")`):

```python
class CardOperation(ChatModel):
    type: Literal["create_card", "edit_card", "move_card"]
    card_id: NonBlankText | None
    column_id: NonBlankText | None
    title: CardTitleText | None     # max_length=200
    details: CardDetailsText | None # max_length=4000
    position: Annotated[int, Field(strict=True, ge=0)] | None
    # model_validator(mode="after"): populated fields must exactly equal
    # the required set for `type` (see table in §3) — no more, no fewer.

class StructuredChatResponse(ChatModel):
    reply: NonBlankText
    operations: list[CardOperation] = Field(max_length=MAX_OPERATIONS)  # 20
```

**Prompt construction** (`build_chat_instructions(board)`): serializes the *entire current* board to compact JSON (`json.dumps(..., separators=(",", ":"), sort_keys=True)`) and embeds it directly in the system instructions, along with the operation contract and an explicit instruction that delete requests must be refused with a fixed reply string ("Delete can only be done manually.") and zero operations. The board embedded here is always freshly loaded from SQLite in the request handler — never anything the client sent.

**`build_chat_messages(history, message)`**: `[*history, {"role": "user", "content": message}]` — pure concatenation, no filtering (filtering already happened via `MAX_HISTORY_MESSAGES`/`MAX_MESSAGE_LENGTH` at the Pydantic layer).

**`safety_identifier(username)`**: `f"pm-{sha256(username).hexdigest()[:32]}"` — sent to OpenAI's `safety_identifier` param instead of the raw username, so no user-identifying string leaves the process toward the provider.

**`AIService`** (`ai.py`): constructed once per request via `AIService.from_environment()` unless a fake is injected (`create_app(ai_service=...)`, used by every non-live test). `generate_structured()` calls `client.responses.parse(model, instructions, input=messages, text_format=StructuredChatResponse, reasoning={"effort": "low"}, safety_identifier=..., store=False)`. Any `OpenAIError`/`ValidationError`/`ValueError` is caught and re-raised as `AIServiceError("OpenAI request failed")` — the original exception (which could contain provider-side detail, including fragments of the request) is never included in the message.

## 6. Session/auth internals (`backend/main.py`)

```python
active_sessions: dict[str, tuple[str, float]]  # token -> (username, expires_at_epoch)
```

- **Login**: `token = secrets.token_urlsafe(32)`; `active_sessions[token] = (MVP_USERNAME, time.time() + SESSION_MAX_AGE)`; cookie set `httponly=True, samesite="lax", secure=False, path="/", max_age=SESSION_MAX_AGE` (`SESSION_MAX_AGE = 8h`).
- **`_resolve_session(token)`**: single source of truth for validity. Returns `None` for a missing/unknown token; for an expired one it **pops the entry** (lazy cleanup — no background sweep needed) and returns `None`; otherwise returns the username. Used by `_authenticated_username`, `/api/auth/session`, and the middleware — no code path checks `active_sessions` directly anymore.
- **Logout**: `active_sessions.pop(token, None)` + `response.delete_cookie(...)` with matching `httponly`/`samesite`/`path`.
- **Middleware** (`protect_authenticated_api`): runs on the outer `application` (wraps the mounted `/api` sub-app), so it sees every request before route dispatch. Gate condition: `path == "/api/board" or path.startswith("/api/board/") or path == "/api/ai" or path.startswith("/api/ai/")`.

Session store is **process memory only** — restarting the container invalidates every session (this is intentional per the MVP's stated auth limitations, not a bug).

## 7. Frontend module contracts

### `lib/kanban.ts` (pure, no React/fetch)

```ts
type Card = { id: string; title: string; details: string }
type Column = { id: string; title: string; cardIds: string[] }
type BoardData = { columns: Column[]; cards: Record<string, Card> }
const MAX_TITLE_LENGTH = 200
const MAX_DETAILS_LENGTH = 4000

moveCard(columns, activeId, overId): Column[]
  // Pure reducer over dnd-kit's active/over ids. Handles: reorder within a
  // column, drop onto a column (append), drop onto another card (insert at
  // that card's index). Used both by KanbanBoard's live drag state and by
  // getCardDestination below.

getCardDestination(columns, activeId, overId): { columnId; position } | null
  // Diffs the board before/after moveCard() to produce the API payload for
  // POST /board/cards/{id}/move. Returns null if the computed destination
  // is identical to the card's current position (no-op drag).
```

### `lib/api.ts`

```ts
request<T>(path, init?): Promise<T>
  // fetch wrapper. credentials: "same-origin" always. Parses the response
  // body as JSON but never lets a parse failure throw uncaught: a failed
  // .json() falls back to `undefined`, and the eventual error uses
  // payload?.detail ?? response.statusText ?? "Request failed". A 2xx
  // response with an unparseable/empty body raises
  // ApiError(status, "Unexpected empty response") rather than returning
  // undefined silently.
```

`sessionApi` / `boardApi` / `chatApi` are thin typed wrappers over `request()` — one function per endpoint in §4's table, each building the exact path/method/body FastAPI expects.

### `KanbanBoard.tsx` — state and data flow

```ts
type BoardLoadResult =
  | { outcome: "success"; board: BoardData }
  | { outcome: "unauthorized" }
  | { outcome: "error" }

fetchBoardResult(): Promise<BoardLoadResult>   // module-level, no setState
applyBoardResult(result): void                 // component-level, setState only
```

Mount effect: `let ignore = false; fetchBoardResult().then(r => { if (!ignore) applyBoardResult(r) }); return () => { ignore = true }`. The manual retry path (`retryLoadBoard`) resets `isLoading`/`loadError` itself (an event handler, so synchronous `setState` there is fine) then calls `fetchBoardResult().then(applyBoardResult)` — same classify/apply functions, no duplicated fetch-and-branch logic. (This split exists specifically so the effect body contains no direct state-setter call chain, satisfying the `react-hooks/set-state-in-effect` lint rule while still sharing one implementation.)

`mutationInFlight` (a `useRef<boolean>`) plus `isMutating` state serialize all board-changing calls (drag, rename, add/edit/delete card, chat) through `runMutation()` — a second mutation attempted while one is in flight is a no-op, not queued. Every `runMutation` call ends by replacing `board` with the server's response; on a 401 it calls `onUnauthorized()` (bubbles to `AuthApp`) instead of showing a board-level error.

Responsive chat visibility: `chatVisibility: boolean | null` (explicit user override) falls back to `isDesktopLayout` (from `useSyncExternalStore` on a `(min-width: 1600px)` media query) when `null`. `getServerSnapshot` is hardcoded `false` — i.e., the pre-hydration assumption is "closed," so any static-export/hydration mismatch resolves toward not showing an overlay panel rather than briefly showing one on a narrow screen.

### `AuthApp.tsx` — session states

```ts
type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; username: string }
  | { status: "error" }
```

Same classify/apply split as `KanbanBoard` (`fetchSessionResult` / `applySessionResult`). The `"error"` state (added in the code review) is reached only when the initial `/api/auth/session` call throws something other than a 401 — e.g. the server is unreachable — and renders a distinct "Unable to reach the server" view with its own retry button, so a real connectivity failure is never silently indistinguishable from "not logged in."

## 8. Test-to-code map

| Behavior | Backend test | Frontend test |
|---|---|---|
| Board CRUD + ordering | `test_app.py`, `test_database.py` | `KanbanBoard.test.tsx` |
| AI operation contract + validation | `test_chat.py` | `KanbanBoard.test.tsx` (chat cases) |
| Auth/session lifecycle incl. expiry | `test_app.py` | `AuthApp.test.tsx` |
| Length-limit validation (manual + AI) | `test_app.py::test_oversized_title_or_details_is_rejected`, `test_chat.py::test_structured_chat_schema_rejects_oversized_title_or_details` | client `maxLength` verified live (see conversation) |
| SQLite busy handling | `test_app.py::test_database_busy_returns_a_safe_error` | – |
| Non-JSON error response handling | – | `api.test.ts` |
| Full user journeys (login → board → AI → persistence) | – | `tests/kanban.spec.ts` (Playwright, mocked `/api/**`) |
| Live OpenAI connectivity | `test_ai_live.py` (opt-in, `RUN_OPENAI_LIVE_TEST=1`) | – |

## 9. Deployment specifics

`Dockerfile` stages: `frontend-build` (node, `npm run build` → `frontend/out`) → `base` (uv-managed Python deps + `backend/` + the built frontend) → `test` (+ `docs/`, dev deps, `CMD pytest`) / `production` (+ non-root `app` user).

Production hardening added in the code review: `groupadd --system app && useradd --system --create-home --gid app app` (a home directory is required so `uv`'s cache dir under `$HOME/.cache` is writable), `chown -R app:app /app`, `apt-get install gosu`. `ENTRYPOINT ["docker-entrypoint.sh"]` **and** an explicit `CMD [...]` in the same stage — Docker resets an inherited `CMD` to empty when a later stage sets `ENTRYPOINT` without redeclaring `CMD`, so both must be set together. The entrypoint (`scripts/docker-entrypoint.sh`) runs as root just long enough to `mkdir -p`/`chown` `/app/data` (needed because the named volume may predate this change and be root-owned) before `exec gosu app "$@"` drops to the non-root user for the life of the process.

`compose.yaml` mounts `pm-data:/app/data`, passes `OPENAI_API_KEY`/`OPENAI_MODEL` through from the shell environment (never baked into the image), and health-checks `GET /api/health` via a plain `python -c urllib.request...` (no extra HTTP client dependency needed for the check itself).
