# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local, single-container Project Management MVP: a Kanban board with drag-and-drop, backed by a FastAPI + SQLite backend, with an AI chat sidebar (OpenAI) that can create/edit/move cards. See `README.md` for user-facing setup and `AGENTS.md` for full business requirements and coding standards.

This repo is built part-by-part against `docs/PLAN.md`. **Read `docs/PLAN.md` before making changes** — it records which parts are done (all 10 are currently checked off) and the conventions each part established. Do not add scope beyond what a part specifies without approval.

## Commands

Frontend (run from `frontend/`):

```sh
npm ci
npm run lint
npm run test:unit
npm run build
npm run test:e2e        # Playwright; needs `npm run build` output present
```

Run a single frontend test file: `npx vitest run src/lib/kanban.test.ts` or `npx playwright test tests/kanban.spec.ts`.

Backend / full container:

```sh
docker build --target test --tag project-management-mvp-test .
docker run --rm project-management-mvp-test
```

The Docker `test` stage builds the frontend first, so backend integration tests that serve `frontend/out` work. To run backend tests locally without Docker, build the frontend first (`cd frontend && npm run build`), then `uv run pytest` from the repo root. Run a single backend test with `uv run pytest backend/tests/test_app.py::test_name`.

One opt-in, billable live OpenAI test (excluded from normal runs):

```sh
docker run --rm --env-file .env --env RUN_OPENAI_LIVE_TEST=1 project-management-mvp-test uv run --no-sync pytest backend/tests/test_ai_live.py
```

Start/stop the app via Compose wrapper scripts in `scripts/` (`start.ps1`/`stop.ps1` on Windows, `start.sh`/`stop.sh` on macOS/Linux) — app serves at `http://localhost:8000`, credentials `user`/`password`.

## Architecture

**Single container, single origin.** The Dockerfile builds the Next.js frontend to a static export (`frontend/out`), then copies it into the Python image. FastAPI serves that static export at `/` and a separate mounted sub-application at `/api` (see `backend/main.py`: `application.mount("/api", api)` then `application.mount("/", StaticFiles(...))`). All API routes live under `/api` specifically so static routing can never mask them.

**Auth is a middleware gate, not per-route.** `backend/main.py` has one `@application.middleware("http")` function that checks the `pm_session` cookie against an in-memory `active_sessions` dict for any path under `/api/board` or `/api/ai`; individual route handlers don't re-check auth themselves (they call `_authenticated_username(request)` to resolve the username, trusting the middleware already gated access). Sessions are server-memory-only opaque tokens — they reset on restart and are not for production use.

**Backend module boundaries** (`backend/`):
- `main.py` — FastAPI app factory (`create_app`), Pydantic request/response models, route wiring, the auth middleware, static mount.
- `database.py` — all SQLite access. Every board-mutating function opens its own connection, resolves the board via the authenticated `username` (never a client-supplied ID), and commits one transaction per call. `apply_card_operations` validates a whole batch of AI-proposed operations against an in-memory copy of the board (`_validate_card_operations`) *before* writing anything, so a batch is all-or-nothing.
- `ai.py` — thin wrapper around the OpenAI Responses API (`AIService`). Swappable via constructor injection (`ai_service` param on `create_app`) so tests use a fake client and never hit the network unless `RUN_OPENAI_LIVE_TEST=1`.
- `chat.py` — the structured-output contract for AI card operations (`CardOperation`, `StructuredChatResponse`), the system prompt builder (`build_chat_instructions`, which serializes the *entire current board* into the prompt), and a privacy-preserving `safety_identifier` (hashed username, not the raw username, sent to OpenAI).

**The AI can never see or trust client-supplied board state.** `POST /api/ai/chat` always loads the board fresh from SQLite by the session's username, builds the prompt from that, and validates every returned operation against that same fresh board before applying anything. The AI is restricted to `create_card` / `edit_card` / `move_card` — it has no delete capability and cannot touch columns; this is enforced both in the prompt and structurally (`CardOperation.type` has no delete variant, and `_validate_card_operations` only understands three operation types).

**Ordering/position invariant.** Cards use a dense zero-based `position` per column. Moves and deletes always renumber affected columns from scratch (`_stage_columns` bumps positions out of the way to avoid unique-constraint collisions mid-update, `_assign_order` then writes the final contiguous order) rather than doing arithmetic shifts — this is deliberate to keep the invariant obviously correct even for cross-column moves in one transaction.

**Frontend data flow.** `src/lib/kanban.ts` holds pure, framework-free types and board-transformation logic (`moveCard`, `getCardDestination`) used both by components and by tests directly — no React or fetch here. `src/lib/api.ts` is the only place that calls `fetch`. `KanbanBoard.tsx` is the stateful component: it applies dnd-kit's optimistic local reorder, then calls the matching `boardApi` mutation, and replaces state with the server's canonical response (never trusts its own optimistic state as final). Components serialize mutations so overlapping drags/edits/AI updates can't race and corrupt visible order.

**Nested AGENTS.md files** exist in `backend/`, `frontend/`, and `scripts/` with directory-specific conventions (e.g. frontend must stay compatible with `output: "export"` — no server-only Next.js features; backend must route new endpoints through the mounted `api` app). Check the relevant one before editing in that directory.

## Key conventions from AGENTS.md

- Keep it simple: no defensive programming or features beyond current plan-part scope.
- When debugging, find root cause before changing code — don't guess-and-check.
- No emojis, ever, anywhere in this repo.
- `.env` (OpenAI key) is never committed, baked into the image, or logged; it's passed to the container only at runtime.
