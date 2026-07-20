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

Sign in with:

- Username: `user`
- Password: `password`

This is local MVP authentication only. Sessions are kept in server memory and
are not intended for production use.

Board data is stored in SQLite on the Compose-managed `pm-data` volume and
persists when the application container is stopped or recreated.

Column renames and card creation, inline editing, deletion, reordering, and
cross-column movement are saved through the authenticated board API.

## OpenAI configuration

Create a project-root `.env` file before running the opt-in OpenAI connectivity
test:

```text
OPENAI_API_KEY=your-key
OPENAI_MODEL=gpt-5.6-terra
```

`OPENAI_MODEL` is optional and defaults to `gpt-5.6-terra`. The key is passed to
the container at runtime and is not included in the image. The authenticated
chat backend is available at `POST /api/ai/chat`; the chat UI is implemented in
Part 10. See `docs/CHAT_API.md` for its request and response contract.

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
