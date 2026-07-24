# Chat API

`POST /api/boards/{boardId}/ai/chat` requires the HTTP-only session cookie.
The server verifies `boardId` belongs to the signed-in user, then loads that
board's canonical state; clients never send a board or user ID, and a
`boardId` owned by another user returns 404.

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
it cannot delete cards, change the fixed columns, or assign/remove labels
(labels are a manual-only feature). All returned operations are validated for
the signed-in user's board and committed in one transaction. One invalid
operation rejects and rolls back the full batch.

OpenAI Responses are parsed against the backend's Pydantic schema with
`store=false`. Provider, parsing, and invalid-operation failures return concise
errors without exposing provider details.

The frontend sends at most the latest 20 successful user/assistant messages.
Reply-only responses append to the conversation without refreshing the board.
Mutation responses immediately replace visible board state with the returned
canonical board. Conversation state is not persisted and clears on logout or
page reload.
