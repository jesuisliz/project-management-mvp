# Board API

All board routes require the HTTP-only session cookie created by
`POST /api/auth/login`. The server resolves the username and its single board
from that session; clients do not send user or board IDs.

| Method | Route | Request body |
| --- | --- | --- |
| `GET` | `/api/board` | None |
| `PATCH` | `/api/board/columns/{columnId}` | `{ "title": "Ready" }` |
| `POST` | `/api/board/cards` | `{ "columnId": "col-backlog", "title": "Card", "details": "Optional" }` |
| `PATCH` | `/api/board/cards/{cardId}` | `{ "title": "Card", "details": "Updated" }` |
| `DELETE` | `/api/board/cards/{cardId}` | None |
| `POST` | `/api/board/cards/{cardId}/move` | `{ "columnId": "col-review", "position": 0 }` |

`position` is a zero-based destination index after removing the moving card
from its source column. It supports same-column reorder, cross-column movement,
and appending at the destination length.

Successful routes return the canonical board shape in
`docs/sample-board.json`; card creation returns HTTP 201 and the others return
HTTP 200. Column/card IDs are stable strings. Column and card titles are trimmed
and must not be blank. Details may be an empty string. Unknown resources return
404, malformed requests return 422, an out-of-range destination returns 400,
and anonymous board requests return 401.

The fixed columns have no create, delete, or reorder routes. Their identities
and positions remain fixed; only their titles can change.
