# Project Management MVP

## Prerequisite

Install Docker Desktop or Docker Engine with Compose.

## Start and stop

Windows PowerShell:

```powershell
./scripts/start.ps1
./scripts/stop.ps1
```

macOS or Linux:

```sh
sh scripts/start.sh
sh scripts/stop.sh
```

Open `http://localhost:8000` after starting.

Sign in with the built-in demo account, or create your own:

- Username: `user`
- Password: `password`

New accounts can be created from the sign-in page. Passwords are hashed
(salted PBKDF2) before being stored; this is still local MVP authentication,
and sessions are kept in server memory and are not intended for production
use.

Board data is stored in SQLite on the Compose-managed `pm-data` volume and
persists when the application container is stopped or recreated. Each user
can hold multiple named boards; a board switcher in the header lets you
create, rename, switch between, and delete boards (a user's last board cannot
be deleted).

Column renames and card creation, inline editing, deletion, reordering,
cross-column movement, and label assignment are saved through the
authenticated board API. Labels are a per-board catalog of colored tags you
can create, rename, delete, and assign to or remove from cards. The AI
Assistant sidebar can answer questions and create, edit, move, or reorder one
or more cards on the currently selected board. It cannot delete cards, change
the fixed columns, or manage labels.

## OpenAI configuration

Create a project-root `.env` file before starting the application with AI chat
or running the opt-in OpenAI connectivity test:

```text
OPENAI_API_KEY=your-key
OPENAI_MODEL=gpt-5.6-terra
```

`OPENAI_MODEL` is optional and defaults to `gpt-5.6-terra`. The key is passed to
the container at runtime and is not included in the image. The authenticated
chat backend is available at `POST /api/boards/{boardId}/ai/chat`. See
`docs/CHAT_API.md` for its request and response contract.

Chat messages are kept only in the current page session. They clear on logout
or reload and are never written to SQLite. AI board changes are validated and
saved to the same persistent board as manual changes.

## Tests

Frontend:

```sh
cd frontend
npm ci
npm run lint
npm run test:unit
npm run build
npm run test:e2e
```

Production container and backend:

```sh
docker build --target test --tag project-management-mvp-test .
docker run --rm project-management-mvp-test
```

Normal tests use a fake OpenAI client and make no network requests. Run the one
billable live connectivity test explicitly:

```sh
docker run --rm --env-file .env --env RUN_OPENAI_LIVE_TEST=1 project-management-mvp-test uv run --no-sync pytest backend/tests/test_ai_live.py
```

The MVP is intended for local use. Sessions are stored in process memory and
reset on restart; this is not production-grade identity management.
