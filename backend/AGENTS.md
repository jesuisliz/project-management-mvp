# Backend guide

This directory contains the FastAPI application and backend tests. FastAPI serves the static Next.js export produced in `frontend/out`. Follow the root `AGENTS.md` and execute only the active part in `docs/PLAN.md`.

## Structure

- `main.py`: root FastAPI application, authentication routes, protected board
  namespace, `/api` sub-application, and frontend static mount
- `tests/`: pytest tests using FastAPI's `TestClient`

## Conventions

- Add API routes to the mounted `api` application so static routing cannot mask them.
- Keep route behavior small and typed.
- Keep the Part 4 session implementation local-only: opaque tokens are held in
  server memory and sent only through the HTTP-only session cookie.
- Test the real `frontend/out` export for static-serving changes.
- Manage Python dependencies in the root `pyproject.toml` and commit `uv.lock`.

Build the frontend before running backend tests locally. The Docker test target performs both steps automatically.
