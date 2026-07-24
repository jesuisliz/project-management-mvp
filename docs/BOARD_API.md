# Board API

All routes below require the HTTP-only session cookie created by
`POST /api/auth/login` or `POST /api/auth/register`. The server resolves the
signed-in username from that session; every route also verifies that the
`boardId` in the path belongs to that user before reading or writing anything.
A board ID that exists but belongs to another user returns 404, identical to
an unknown ID.

## Boards

| Method | Route | Request body |
| --- | --- | --- |
| `GET` | `/api/boards` | None — lists `{ "id": 1, "name": "My Board" }` for the signed-in user |
| `POST` | `/api/boards` | `{ "name": "Sprint 12" }` — creates a new, empty board with the fixed five columns |
| `PATCH` | `/api/boards/{boardId}` | `{ "name": "Renamed" }` |
| `DELETE` | `/api/boards/{boardId}` | None — rejected with 400 if it is the user's only board |

Every user is provisioned with one board on registration. `DELETE` returns the
user's remaining board list; the other board routes return the full board
below.

## Columns and cards

| Method | Route | Request body |
| --- | --- | --- |
| `GET` | `/api/boards/{boardId}` | None |
| `PATCH` | `/api/boards/{boardId}/columns/{columnId}` | `{ "title": "Ready" }` |
| `POST` | `/api/boards/{boardId}/cards` | `{ "columnId": "col-backlog", "title": "Card", "details": "Optional" }` |
| `PATCH` | `/api/boards/{boardId}/cards/{cardId}` | `{ "title": "Card", "details": "Updated" }` |
| `DELETE` | `/api/boards/{boardId}/cards/{cardId}` | None |
| `POST` | `/api/boards/{boardId}/cards/{cardId}/move` | `{ "columnId": "col-review", "position": 0 }` |

`position` is a zero-based destination index after removing the moving card
from its source column. It supports same-column reorder, cross-column movement,
and appending at the destination length.

## Labels

| Method | Route | Request body |
| --- | --- | --- |
| `POST` | `/api/boards/{boardId}/labels` | `{ "name": "Urgent", "color": "#ecad0a" }` |
| `PATCH` | `/api/boards/{boardId}/labels/{labelId}` | `{ "name": "Blocked", "color": "#753991" }` |
| `DELETE` | `/api/boards/{boardId}/labels/{labelId}` | None |
| `PUT` | `/api/boards/{boardId}/cards/{cardId}/labels` | `{ "labelIds": ["label-abc"] }` — replaces the card's full label set |

Labels are scoped to their board; a label ID from one board is not valid on
another. Deleting a label removes it from every card that had it.

Successful routes return the canonical board shape in
`docs/sample-board.json` (now including each card's `labelIds` and the board's
`labels` catalog); card and label creation return HTTP 201, others return HTTP
200. Column/card/label IDs are stable strings; board IDs are integers.
Titles/names are trimmed and must not be blank. Details may be an empty
string. Unknown resources return 404, malformed requests return 422, an
out-of-range destination returns 400, and anonymous requests return 401.

The fixed columns have no create, delete, or reorder routes. Their identities
and positions remain fixed; only their titles can change.
