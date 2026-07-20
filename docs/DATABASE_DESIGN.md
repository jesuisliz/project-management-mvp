# Part 5 database design

## Scope

This document proposes the SQLite design for Parts 6 through 10. Part 5 adds
documentation only; database code and API routes begin after this design is
approved.

The relational definition is in `docs/database-schema.json`. The canonical API
shape and deterministic demo content are in `docs/sample-board.json`.

## Relational model

The database has four tables:

| Table | Purpose |
| --- | --- |
| `users` | Owns a username. Authentication remains the hardcoded MVP login. |
| `boards` | Gives each user exactly one board through a unique `user_id`. |
| `columns` | Stores the five fixed identities, their fixed positions, and editable titles. |
| `cards` | Stores card content, column membership, and position within that column. |

Column and card IDs are text identifiers scoped to a board. Their primary keys
include `board_id`, so every user can receive the same deterministic template
IDs without collisions. API lookups always derive `board_id` from the signed-in
user and never accept a user or board owner from the browser.

The composite card-to-column foreign key, `(board_id, column_id)`, prevents a
card from referencing a column on another board. Deleting a user cascades to
their board, columns, and cards. Deleting a card is a hard delete; the MVP has no
undo, history, or audit requirement.

Primary-key and unique constraints provide all required indexes:

- username lookup;
- one-board-per-user lookup;
- columns ordered by board and position;
- cards ordered by board, column, and position.

No additional indexes are justified for the single-board MVP.

## Invariants

- A user has at most one board.
- A provisioned board has exactly these column IDs in positions `0` through
  `4`: `col-backlog`, `col-discovery`, `col-progress`, `col-review`, and
  `col-done`.
- Normal APIs may rename columns but may not create, delete, or reorder them.
- Column titles and card titles must contain non-whitespace text.
- Card details are stored as a non-null string. Missing details use `""`; any
  friendly fallback text is a presentation concern.
- Card positions are zero-based, unique within a column, and contiguous after
  every committed mutation.
- Column positions are zero-based and unique within a board.
- Stable IDs do not change when a column is renamed or a card is edited or
  moved.
- Timestamps are omitted because the MVP has no sorting, audit, synchronization,
  or conflict-resolution behavior that consumes them.

SQLite constraints enforce ownership, uniqueness, valid position ranges, and
nonblank titles. Exactly five populated columns and contiguous card positions
are set by provisioning and preserved by the service because SQL row checks
cannot express either cross-row rule simply. Column create/delete/reorder routes
will not exist.

## State transitions

| Operation | Read/write behavior | Transaction rule |
| --- | --- | --- |
| Load board | Resolve board by authenticated username; order columns and cards by `position`. | Read-only. |
| Rename column | Update `columns.title` using both `board_id` and column ID. | One write transaction. |
| Create card | Insert into the requested owned column at `max(position) + 1`. | One write transaction. |
| Edit card | Update title/details using both `board_id` and card ID. | One write transaction. |
| Delete card | Delete the owned card and compact later positions in its column. | One write transaction. |
| Reorder card | Compute the resulting order and rewrite positions in the same column. | One write transaction. |
| Move card | Change the owned card's column and rewrite source and destination positions. | One write transaction covering both columns. |
| AI batch | Validate every requested operation first, then apply all resulting changes. | One transaction for the entire batch; any failure rolls it all back. |

Position rewrites use a temporary, nonoverlapping high range inside the same
transaction before assigning final zero-based values. This preserves the unique
position constraint without exposing an intermediate order.

## Initialization and seed behavior

Application startup will create the database directory and schema when needed,
then run idempotent provisioning in a single transaction:

1. Insert the hardcoded `user` row if it does not exist.
2. If that user has no board, create one board.
3. Create the five fixed columns with the current titles and order.
4. Insert the eight current demo cards with their current column membership and
   order from `docs/sample-board.json`.

If the board already exists, startup does not reseed or replace it. This means a
user may intentionally edit or delete all cards without the next restart
restoring demo data. The same provisioning function can create a future user's
single board from the same template, with IDs safely scoped by that board.

The password is not stored in SQLite. Part 4 authentication remains hardcoded;
the database user row supplies ownership for board data only.

## Python and SQLite access

Part 6 should use Python's standard `sqlite3` module with small synchronous
repository functions. FastAPI's board endpoints can remain normal synchronous
functions, so an ORM or async database layer would add no MVP value.

Each connection must enable `PRAGMA foreign_keys = ON` and use `sqlite3.Row` for
named access. Startup schema creation and provisioning use one transaction.
Every board mutation uses one short transaction; reads use a short-lived
connection. Rejected validation must occur before writes where possible, and
any database error rolls back the active transaction.

The database path will come from `DATABASE_PATH`:

- container default: `/app/data/pm.db`;
- automated tests: a fresh path under the test temporary directory.

Compose will mount a named volume such as `pm-data` at `/app/data`. Stopping or
recreating the application container therefore preserves the database; removing
the named volume intentionally resets it. The database file must not be copied
into an image layer or committed to source control.

## API representation

`GET /api/board` will return the signed-in user's board in the normalized shape
shown in `docs/sample-board.json`. Column array order represents column order,
each `cardIds` array represents card order, and `cards` contains content keyed by
stable card ID. Internal database IDs and ownership fields are not exposed.

Mutations in Part 6 should return the canonical updated board (or a focused
resource only when Part 6 demonstrates that it reduces duplication). The
browser never supplies an authoritative board snapshot, user ID, or board ID.

## Verification strategy

Part 6 tests will use an isolated temporary database and cover:

- missing-file creation and the complete demo seed;
- repeated startup without duplicate or restored data;
- provisioning a second user with a separate board;
- foreign-key enforcement and cross-board reference rejection;
- one board per user and unique ordering constraints;
- deterministic ordered reads;
- persistence after closing and reopening the database;
- every manual mutation, validation failure, and transaction rollback;
- authenticated scoping that prevents one user from reading or changing another
  user's rows.

This supports future multiple users without adding multiple boards, roles,
permissions, soft deletion, audit history, migrations, or chat persistence.
