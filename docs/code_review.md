# Code review

Date: 2026-07-20
Scope: full repository (`backend/`, `frontend/`, `scripts/`, Docker/Compose, docs).
All 10 parts of `docs/PLAN.md` are complete; this review covers the finished MVP, not work-in-progress.

**Status: all 9 findings below (4 Moderate, 5 Low) have been remediated** the same day, with new regression tests for each and a full re-run of the test suite (frontend lint/unit/build/e2e, backend Docker `test` target, and a live container smoke test including the Docker user change). See the "Resolution" line under each finding.

## Method

Read every backend and frontend source file, every `AGENTS.md`, all of `docs/`, the Dockerfile/Compose setup, and the test suites. Cross-checked behavior against the documented invariants in `docs/DATABASE_DESIGN.md`, `docs/BOARD_API.md`, and `docs/CHAT_API.md`. Also ran the full test suite (frontend lint/unit/build/e2e, backend Docker `test` target, a live container smoke test) — all passed; see the prior conversation turn for the run-by-run results. This report covers issues that passing tests don't currently catch.

## Summary

The codebase is small, consistent, and unusually well-covered by its own stated conventions: every mutation is transactional and re-derives ownership from the session, the AI path never trusts client-supplied board state, and card ordering is kept contiguous by a careful stage-then-reassign pattern (verified correct by hand and by `test_database.py`/`test_app.py`). No correctness bugs were found in the core board or AI-operation logic. The findings below are smaller robustness, validation, and hygiene gaps.

## Findings

### Moderate

1. **`api.ts` request helper assumes every response body is JSON.**
   `frontend/src/lib/api.ts:24-38` — `request()` always calls `await response.json()` before checking `response.ok`. If the backend ever returns a non-JSON body (an unhandled exception producing Starlette's default error page, a proxy error page, an empty `204`, etc.), this throws a raw `SyntaxError` instead of the intended `ApiError`, so callers' `catch` blocks (which check `error instanceof ApiError`) fall through to a generic failure path or an uncaught rejection rather than the app's normal error messaging.
   *Action:* guard the `.json()` call (e.g. check `content-type` or wrap in try/catch and fall back to `response.statusText`) so any non-JSON error still surfaces as an `ApiError`.
   *Resolution:* `request()` now wraps `.json()` in try/catch and falls back to `response.statusText`; a non-JSON success response is rejected as an `ApiError("Unexpected empty response")`. New test: `api.test.ts` — "surfaces a safe error when a failed response has no JSON body".

2. **Card title/details have no upper length bound, including for AI-issued operations.**
   `backend/main.py` (`CreateCardRequest`, `EditCardRequest`) and `backend/chat.py` (`CardOperation`) constrain `title` to non-blank but set no `max_length`, unlike the chat `message`/history fields which are capped at `MAX_MESSAGE_LENGTH` (2,000 chars, `backend/chat.py:15`). A manual API caller — or a model response — can create/edit a card with an arbitrarily long title or details string. This isn't currently a security issue (SQLite and the UI both render it as plain escaped text), but it's an inconsistency: the one field that's untrusted-model output *and* unbounded is exactly the field that most needs a defensive limit.
   *Action:* add a `max_length` to card `title`/`details` (a few hundred/thousand chars, matching what the UI can reasonably render) in both `main.py`'s request models and `chat.py`'s `CardOperation`.
   *Resolution:* added `MAX_CARD_TITLE_LENGTH` (200) / `MAX_CARD_DETAILS_LENGTH` (4,000) in `chat.py`, applied to `CardOperation`, `RenameColumnRequest`, `CreateCardRequest`, and `EditCardRequest`. Mirrored as `maxLength` attributes on the corresponding frontend inputs (`NewCardForm`, `KanbanCard`, `KanbanColumn`) so users get inline feedback instead of a 422. New tests: `test_app.py::test_oversized_title_or_details_is_rejected`, `test_chat.py::test_structured_chat_schema_rejects_oversized_title_or_details`.

3. **No SQLite busy timeout; concurrent writes can surface as an unhandled 500.**
   `backend/database.py:152-156` (`_connect`) opens each connection with `sqlite3.connect(database_path)` and no explicit `timeout=`. Two requests that write at the same time (e.g. the same user open in two browser tabs, or a manual edit racing an AI chat mutation) can raise `sqlite3.OperationalError: database is locked` after SQLite's default 5s wait. Nothing in `backend/main.py` catches `sqlite3.OperationalError`, so it would surface as a generic unhandled-exception 500 instead of the app's consistent `{"detail": ...}` JSON error shape. The frontend's `mutationInFlight` ref (`KanbanBoard.tsx:81`) only serializes requests from a single tab, so it doesn't prevent this across tabs/devices.
   *Action:* either explicitly document single-tab/single-session usage as an MVP limitation, or add a small `timeout=`/WAL pragma and a generic `sqlite3.OperationalError` exception handler that returns a safe JSON 503/409.
   *Resolution:* `_connect()` now opens with `timeout=10.0` and `PRAGMA journal_mode = WAL`; `main.py` registers an `sqlite3.OperationalError` exception handler returning a safe `503 {"detail": "The board is busy. Please try again."}`. New test: `test_app.py::test_database_busy_returns_a_safe_error`.

4. **A Playwright test artifact is committed to git.**
   `frontend/test-results/.last-run.json` is tracked (added in the "Part 7 completed" commit) even though `frontend/.gitignore` has no entry for Playwright's `test-results/` output directory. It's harmless in content (`{"status":"passed","failedTests":[]}`) but it's a generated file that will keep changing/conflicting as tests are re-run, and its presence suggests the gitignore has a gap.
   *Action:* add `/test-results` (and `/playwright-report` in case the HTML reporter is ever enabled) to `frontend/.gitignore`, and `git rm --cached frontend/test-results/.last-run.json`.
   *Resolution:* done exactly as described — `frontend/.gitignore` now excludes `/test-results` and `/playwright-report`, and the tracked file was untracked via `git rm --cached`.

### Low

5. **`active_sessions` never expires server-side.**
   `backend/main.py:46` — session tokens are removed only on explicit `/api/auth/logout`. A cookie that simply expires client-side after `SESSION_MAX_AGE` (8h, `main.py:42`) leaves its entry in the in-memory dict forever. For the documented single hardcoded MVP user this is negligible, but it's an unbounded-growth pattern worth a one-line comment (or a lazy expiry check) if the session store is ever reused for a multi-user scenario.
   *Resolution:* `active_sessions` now stores `(username, expires_at)`; a new `_resolve_session()` helper checks and lazily purges expired entries, used by `_authenticated_username`, `/auth/session`, and the auth middleware. New test: `test_app.py::test_expired_session_is_rejected_and_purged`.

6. **Duplicated board-loading logic in `KanbanBoard.tsx`.**
   `frontend/src/components/KanbanBoard.tsx:95-132` — `loadBoard` (a `useCallback`, used only by the "Try again" button) and the mount `useEffect` both implement essentially the same "fetch board → handle 401 → handle other errors → stop loading" logic independently, rather than the effect calling `loadBoard()`. They currently stay in sync, but any future edit to one and not the other (e.g. a new error case) will silently diverge.
   *Action:* have the mount effect call `loadBoard()`, or extract a single shared loader that both an effect-scoped `isActive` flag and the retry button can use.
   *Resolution:* extracted a single setState-free `fetchBoardResult()` (classifies success/unauthorized/error) and a single `applyBoardResult()` that both the mount effect and the "Try again" button now call — one code path instead of two. (The initial design called the loader directly from the effect, but that triggers React's `set-state-in-effect` lint rule since the shared function itself calls setState; separating "fetch+classify" from "apply to state" satisfies the rule without reintroducing duplication.)

7. **Session-bootstrap failures are indistinguishable from "not logged in".**
   `frontend/src/components/AuthApp.tsx:169-176` — `loadSession`'s catch-all treats *any* error (a real network/server-down failure, not just a 401) identically to an anonymous session, silently showing the login form. `KanbanBoard` handles the analogous case (`loadBoard`, `main.py`) with an explicit "Unable to load your board. Check the server and try again." message; `AuthApp` has no equivalent, so a user hitting the app while the backend is down sees a plain sign-in screen with no indication anything is wrong.
   *Resolution:* added a distinct `{status: "error"}` session state with an "Unable to reach the server" view and a retry button, using the same `fetchSessionResult()`/`applySessionResult()` split as finding 6. New test: `AuthApp.test.tsx` — "shows a retry option when the session check fails outright".

8. **Possible one-frame layout flash of the AI sidebar on narrow screens.**
   `frontend/src/components/KanbanBoard.tsx:82-86` — `useSyncExternalStore`'s `getServerSnapshot` argument is hard-coded to `true` (desktop/chat-open), used to match whatever layout was baked into the static export at build time. On a narrow viewport, the very first paint after hydration can therefore briefly assume the desktop chat-open state before the real `matchMedia` check corrects it. Likely imperceptible in practice, but the same tests that check "keeps chat closed by default on a narrow screen" (`tests/kanban.spec.ts:311`) wouldn't catch a one-frame flash since Playwright doesn't assert on intermediate paints.
   *Resolution:* flipped the safe default from `true` to `false`, so any pre-hydration mismatch now errs toward not showing an overlay over content on mobile rather than briefly showing one. All 14 Playwright tests (including both chat-visibility tests) still pass.

9. **Production image runs as root.**
   `Dockerfile` has no `USER` directive in the `production` stage, so the FastAPI process runs as root inside the container. Low risk for a local single-container MVP with no exposed privileged operations, but a cheap, standard hardening step (`RUN useradd ... && USER app`) if this is ever exposed beyond localhost.
   *Resolution:* added a non-root `app` system user and `gosu`; a new `scripts/docker-entrypoint.sh` (running as root only long enough to `chown` `/app/data`, since the existing named volume predates this change and was root-owned) then `exec`s the real process as `app`. Verified against the actual pre-existing local `pm-data` volume: container starts healthy, `ps`/`/proc` inspection confirms the real uvicorn process runs as uid 999 (not root), all pre-existing board data (including a manually-created "Part 10 validated" card) is intact and unchanged, and a live create+delete round-trip through the API confirmed writes succeed as the non-root user.

## What's solid (not exhaustive)

- Ownership is re-derived from the session on every board/AI request; nothing ever trusts a client-supplied board, user ID, or board ID (`backend/main.py`, `backend/chat.py`).
- The stage-to-a-high-range-then-reassign trick in `database.py` (`_stage_columns`/`_assign_order`) is correct under the composite `(board_id, column_id, position)` unique constraint for both same-column reorders and cross-column moves — verified by hand and by the ordering tests in `test_database.py`/`test_app.py`.
- AI-issued operations are validated in full against a fresh in-memory copy of the board before any write, and applied/rolled back as a single transaction (`apply_card_operations`), so a partially-invalid batch can't corrupt state — covered by `test_invalid_ai_batch_returns_safe_error_and_rolls_back`.
- Provider errors and configuration errors are consistently sanitized before reaching the client (`test_provider_error_does_not_leak_details`, `test_generate_structured_sanitizes_provider_errors`).
- `.env` is correctly excluded from git and from the Docker build context, and only injected at container runtime.
