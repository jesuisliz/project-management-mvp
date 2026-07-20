# Backend guide

This directory contains the FastAPI application and backend tests. FastAPI serves the static Next.js export produced in `frontend/out`. Follow the root `AGENTS.md` and execute only the active part in `docs/PLAN.md`.

## Structure

- `main.py`: application factory, authentication and typed board routes,
  protected `/api/board` namespace, and frontend static mount
- `database.py`: SQLite schema, deterministic provisioning, owned board reads,
  and transactional board mutations
- `ai.py`: OpenAI Responses API service, runtime configuration, and sanitized
  provider errors
- `tests/`: pytest tests using FastAPI's `TestClient`

## Conventions

- Add API routes to the mounted `api` application so static routing cannot mask them.
- Keep route behavior small and typed.
- Keep the Part 4 session implementation local-only: opaque tokens are held in
  server memory and sent only through the HTTP-only session cookie.
- Resolve every board operation through the username stored in the session.
  Never accept a user ID or board ID from the browser.
- Open SQLite connections through the database helper so foreign-key
  enforcement is enabled. Keep each mutation atomic and preserve contiguous
  card positions.
- Use a temporary `DATABASE_PATH` in tests. Production Compose stores the
  database at `/app/data/pm.db` on its named volume.
- Keep normal OpenAI tests fake and network-free. The live test must remain
  explicitly enabled with `RUN_OPENAI_LIVE_TEST=1` and receive the API key only
  at runtime.
- Test the real `frontend/out` export for static-serving changes.
- Manage Python dependencies in the root `pyproject.toml` and commit `uv.lock`.

Build the frontend before running backend tests locally. The Docker test target performs both steps automatically.
