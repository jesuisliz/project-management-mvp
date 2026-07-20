# Chat API

`POST /api/ai/chat` requires the HTTP-only session cookie. The server loads the
signed-in user's canonical board; clients never send a board, user ID, or board
ID.

Request:

```json
{
  "message": "Move the roadmap card to Review",
  "history": [
    { "role": "user", "content": "What is in progress?" },
    { "role": "assistant", "content": "Two cards are in progress." }
  ]
}
```

`message` and each history entry are limited to 2,000 characters. History is
limited to 20 user/assistant messages and is not stored by the backend.

Reply-only response:

```json
{
  "reply": "Two cards are currently in progress.",
  "boardChanged": false
}
```

When the assistant changes cards, `boardChanged` is true and `board` contains
the updated canonical board. The model may create, edit, move, or reorder cards;
it cannot delete cards or change the fixed columns. All returned operations are
validated for the signed-in user's board and committed in one transaction. One
invalid operation rejects and rolls back the full batch.

OpenAI Responses are parsed against the backend's Pydantic schema with
`store=false`. Provider, parsing, and invalid-operation failures return concise
errors without exposing provider details.
