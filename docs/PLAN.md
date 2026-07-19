# Project Management MVP implementation plan

## How this plan is executed

- Work through one numbered part at a time.
- At the end of each part, run its verification, summarize the files changed and test results, and stop for user approval before starting the next part.
- Do not start a later part early, even when it would be convenient.
- If a test exposes a problem, identify and demonstrate the root cause before changing the implementation.
- Keep the MVP local and single-board while retaining user ownership in the data model for future multi-user support.
- Use OpenAI directly for AI calls. Read `OPENAI_API_KEY` from the project-root `.env`; never commit or print it.

## Part 1: Plan

### Goal

Create an implementation plan detailed enough to execute and document the existing frontend for future agents.

### Checklist

- [x] Review the root `AGENTS.md` and the original high-level plan.
- [x] Inspect the existing frontend source, configuration, dependencies, and tests.
- [x] Resolve the AI provider decision: use OpenAI, not OpenRouter.
- [x] Add `frontend/AGENTS.md` describing the current architecture, behavior, conventions, and verification commands.
- [x] Expand every implementation part into bounded tasks, tests, and success criteria.
- [x] Review the expanded plan for ordering, requirement coverage, and approval gates.
- [x] Receive explicit user approval for this plan.

### Tests

- Confirm every part has a goal, checklist, tests, and measurable success criteria.
- Confirm the plan covers sign-in, a persistent fixed-column board, card creation/editing/movement, column renaming, AI chat, Docker, and platform scripts.
- Confirm OpenAI is the only configured AI provider; historical decision text may mention the rejected alternative.
- Confirm `frontend/AGENTS.md` matches the code as it exists before implementation.

### Success criteria

- The implementation can be completed one part at a time without relying on unstated scope.
- Frontend-specific instructions accurately describe the starting point.
- The user approves the plan before Part 2 begins.

## Part 2: Scaffolding

### Goal

Create the smallest Dockerized FastAPI application, prove static-file delivery and an API request, and provide start/stop scripts for Windows, macOS, and Linux.

### Checklist

- [x] Create the Python project metadata and lockfile using `uv`.
- [x] Add a minimal FastAPI application under `backend/` with an application factory or module-level app kept simple enough for tests.
- [x] Add `GET /api/health` returning a small JSON health response.
- [x] Serve a temporary static HTML page at `/` that calls `/api/health` and renders the result.
- [x] Add a production Dockerfile that installs Python dependencies with `uv` and runs FastAPI on a documented local port.
- [x] Add a minimal Compose file for a single application container.
- [x] Add Windows PowerShell start/stop scripts and POSIX start/stop scripts usable on macOS and Linux.
- [x] Make the start scripts build and start the container and the stop scripts stop the same Compose project.
- [x] Replace the placeholder text in `backend/AGENTS.md` and `scripts/AGENTS.md` with accurate instructions.
- [x] Add a minimal root README with prerequisites, start, stop, and test commands.

### Tests

- Backend unit test: `/api/health` returns HTTP 200 and the expected JSON.
- Static integration test: `/` returns HTTP 200 and the temporary HTML references the health API.
- Container smoke test: build and start the container, request `/` and `/api/health` from the host, then stop it cleanly.
- Script checks: validate PowerShell syntax on Windows and POSIX shell syntax for the shared macOS/Linux scripts.

### Success criteria

- A new checkout can be started locally using the platform-appropriate script.
- One Docker container serves both the temporary page and the FastAPI route.
- The page visibly confirms a successful browser-to-API request.
- Stop scripts remove the running application cleanly without deleting source or unrelated Docker resources.
- All Part 2 tests pass and the user approves moving to Part 3.

## Part 3: Add the frontend

### Goal

Build the existing Next.js demo as static assets and serve it from FastAPI at `/` without changing its user-facing Kanban behavior.

### Checklist

- [x] Configure Next.js for static export.
- [x] Update the container build to install frontend dependencies, run the production frontend build, and copy the exported assets into the FastAPI image.
- [x] Replace the temporary HTML handler with FastAPI static asset serving and an SPA-safe root/fallback strategy that does not mask `/api/*` errors.
- [x] Preserve the current five-column demo, styling, column rename, add/remove card, and drag/drop behavior.
- [x] Ensure frontend fonts/assets work in the container build and do not depend on a Next.js runtime server.
- [x] Keep frontend unit and browser test commands available outside Docker for fast feedback.
- [x] Add backend integration coverage for the exported index and representative static assets.
- [x] Update the README and relevant `AGENTS.md` files for the combined build and static serving flow.

### Tests

- Frontend checks: lint, TypeScript/production build, existing Vitest suite, and existing Playwright suite.
- Static-serving integration tests: `/` returns the exported application, a hashed asset returns successfully, and an unknown `/api/*` path remains an API 404.
- Container browser smoke test: load the board from the Dockerized FastAPI server and verify five columns render.
- Regression browser tests: rename a column, add/remove a card, and move a card between columns.

### Success criteria

- FastAPI serves the production static Next.js export at `/` from the single container.
- No separate Next.js server is required at runtime.
- Existing demo behavior and project colors are preserved.
- All Part 3 tests pass and the user approves moving to Part 4.

## Part 4: Add the fake user sign-in experience

### Goal

Require the hardcoded MVP credentials `user` / `password` before showing the board, and support logout with a simple server-recognized session.

### Checklist

- [ ] Add login, logout, and current-session API routes.
- [ ] Validate only the hardcoded MVP credentials and return a generic error for invalid credentials.
- [ ] Store authentication in an HTTP-only, same-site cookie so frontend code does not persist a password or bearer token.
- [ ] Protect board API namespaces in preparation for later parts, while leaving health checks public.
- [ ] Add a frontend session bootstrap state so the board is not shown before authentication is known.
- [ ] Add an accessible login form with username, password, submit state, and invalid-credentials feedback.
- [ ] Show the signed-in username and a logout action in the board UI.
- [ ] Return to the login view after logout and after an unauthorized session response.
- [ ] Document that this is local MVP authentication, not production-grade identity management.

### Tests

- Backend tests: valid login sets the expected cookie; invalid login is rejected; session reports authenticated/unauthenticated state; logout clears the cookie; protected API paths reject anonymous requests.
- Frontend component tests: login form validation, invalid-credentials feedback, authenticated board rendering, and logout transition.
- Browser tests: anonymous users see login; `user` / `password` opens the board; bad credentials do not; reload retains the session; logout hides the board.

### Success criteria

- An anonymous browser cannot view the board.
- The specified credentials consistently sign in, and logout consistently ends the session.
- Credentials are never stored in frontend persistence or logged.
- All Part 4 tests pass and the user approves moving to Part 5.

## Part 5: Database modeling

### Goal

Propose the SQLite data model and persistence rules as documentation, then obtain approval before implementing it.

### Checklist

- [ ] Inventory every state transition required by the UI and future AI operations: load board, rename column, create/edit/delete/move card, and preserve ordering.
- [ ] Define user ownership even though the MVP exposes only the hardcoded user.
- [ ] Define one board per user, fixed ordered columns with editable titles, ordered cards, stable IDs, and timestamps only where they serve an MVP need.
- [ ] Define keys, foreign keys, uniqueness constraints, ordering fields, indexes, and delete behavior.
- [ ] Specify deterministic creation and seed behavior for a new database and a user's first board.
- [ ] Save the proposed schema as machine-readable JSON in `docs/`.
- [ ] Document the chosen Python/SQLite access approach, transaction boundaries, database file location, container volume, initialization behavior, and testing strategy.
- [ ] Include sample board JSON showing the API-facing shape separately from the relational storage schema.
- [ ] Review the proposal against future multi-user support without adding multi-board UI or permissions features.
- [ ] Receive explicit user approval of the schema and database approach.

### Tests

- Validate that the schema JSON is syntactically valid JSON.
- Trace each required board operation to the tables and constraints it uses.
- Check that card and column ordering is unambiguous and that a card cannot belong to another user's board.
- Check that a new database and a new user both have documented initialization paths.

### Success criteria

- The approved design supports all MVP board operations and one board per user.
- Fixed columns can be renamed and ordered but not accidentally added or removed through normal APIs.
- The database persists through container restarts using a documented volume.
- No database implementation starts until the user approves the proposal.

## Part 6: Backend board API

### Goal

Implement the approved SQLite model and authenticated FastAPI routes for reading and changing the signed-in user's board.

### Checklist

- [ ] Add the approved database dependencies and configuration.
- [ ] Create the SQLite database and schema automatically when the configured database file does not exist.
- [ ] Enable and test SQLite foreign-key enforcement.
- [ ] Create the hardcoded MVP user and its initial board idempotently.
- [ ] Add Pydantic request/response models for the canonical board representation.
- [ ] Add an authenticated route to fetch the current user's board.
- [ ] Add routes to rename a column and create, edit, delete, and move a card.
- [ ] Validate ownership, fixed-column constraints, required card fields, IDs, and move destinations.
- [ ] Make board mutations transactional so ordering and card membership cannot be partially updated.
- [ ] Return small, consistent HTTP errors for invalid input, missing resources, and unauthenticated requests.
- [ ] Keep persistence/business logic separate from HTTP route wiring only where that separation reduces duplication and improves tests.
- [ ] Update backend documentation and test commands.

### Tests

- Database tests: empty-file initialization, idempotent startup/seed, constraints, ordering, and persistence after reconnect.
- API tests: authenticated board read; rename column; create, edit, delete, reorder, and cross-column move card.
- Validation tests: blank required fields, unknown IDs, invalid destinations, fixed-column violations, and duplicate/invalid ordering inputs.
- Authorization tests: anonymous requests fail and one user cannot access or mutate another user's records using constructed test fixtures.
- Transaction test: a rejected mutation leaves the prior board unchanged.

### Success criteria

- Every required manual board operation is available through a documented authenticated API.
- The API always scopes data to the signed-in user.
- A missing database is created and seeded automatically; an existing database is preserved.
- Board data remains valid and ordered after every mutation.
- All Part 6 tests pass and the user approves moving to Part 7.

## Part 7: Connect the frontend and backend

### Goal

Replace the frontend's in-memory demo state with the authenticated board API so all user changes persist.

### Checklist

- [ ] Define a small typed frontend API client for session and board routes.
- [ ] Load the current user's board after successful session bootstrap/login.
- [ ] Add clear loading and actionable error states for the initial board request.
- [ ] Wire column rename, card create, card edit, card delete, reorder, and cross-column move to backend mutations.
- [ ] Add the missing card-editing UI required by the business requirements.
- [ ] Update local UI from confirmed server responses, using optimistic behavior only where rollback remains simple.
- [ ] Prevent overlapping mutations that could corrupt visible ordering.
- [ ] Handle unauthorized responses by returning to login.
- [ ] Remove production reliance on `initialData`; retain explicit fixtures only in tests or first-board seeding code.
- [ ] Keep the fixed five-column layout and existing visual language.

### Tests

- Frontend unit/component tests: board loading/error states and every mutation with mocked API responses, including card editing and unauthorized responses.
- Backend/frontend integration tests: response shapes consumed by the real frontend types remain compatible.
- Browser tests against the container: login, rename, add, edit, delete, reorder, cross-column move, reload, and verify each change persists.
- Restart smoke test: change the board, restart the container without deleting its volume, and verify the data remains.
- Regression tests: logout/login returns to the same persisted board and no demo-only state reappears.

### Success criteria

- All board reads and writes use the backend API.
- Every manual board operation persists across reload and container restart.
- The frontend provides card editing in addition to the existing operations.
- Failures do not leave the UI showing a silently unpersisted board.
- All Part 7 tests pass and the user approves moving to Part 8.

## Part 8: OpenAI connectivity

### Goal

Add a minimal backend OpenAI client and prove an authenticated live call works using the configured project key.

### Checklist

- [ ] Add the official OpenAI Python SDK through `uv`.
- [ ] Load `OPENAI_API_KEY` from the environment and choose the model through an `OPENAI_MODEL` setting with a documented default.
- [ ] Fail an AI request with a concise configuration error when the key is absent, without preventing non-AI features from starting or exposing the key.
- [ ] Add a small AI service boundary that can be replaced with a fake in normal automated tests.
- [ ] Add an explicit, opt-in live connectivity test that asks `2+2` and checks for an answer of `4`.
- [ ] Ensure the container receives the key at runtime rather than baking `.env` into its image.
- [ ] Document how to run the live test and any cost/network expectation.

### Tests

- Unit tests with a fake client: configured model/request is passed correctly; API and configuration errors are translated without secret leakage.
- Container configuration check: the key is available to the process at runtime and absent from built image layers and committed files.
- Opt-in live test: make one real OpenAI call for `2+2` and verify the response contains `4`.

### Success criteria

- The backend can complete a real OpenAI request from the local container.
- Normal automated tests do not require network access or spend API credit.
- API keys do not appear in source, logs, responses, test output, or image layers.
- All Part 8 tests pass, including the explicitly run live smoke test, and the user approves moving to Part 9.

## Part 9: Structured AI board operations

### Goal

Create the chat backend that sends the current board, the user's message, and conversation history to OpenAI and safely applies optional structured card operations.

### Checklist

- [ ] Define a strict Structured Outputs schema containing a user-facing reply and an ordered list of optional card operations.
- [ ] Limit AI operations to the required capabilities: create one or more cards, edit cards, and move/reorder cards. Do not give the AI a delete operation unless requirements change.
- [ ] Define the chat request shape with the current message and bounded conversation history.
- [ ] Fetch the canonical current board on the backend; do not trust a board snapshot supplied by the browser.
- [ ] Build a concise system instruction containing the board JSON, supported operations, stable IDs, fixed-column rules, and response expectations.
- [ ] Call OpenAI with strict structured parsing through the Part 8 service.
- [ ] Validate every returned operation against the signed-in user's current board before applying any change.
- [ ] Apply all operations in one database transaction and roll back the full set if any operation is invalid.
- [ ] Return the assistant reply plus whether the board changed and the updated canonical board when it did.
- [ ] Keep conversation history session-local in the frontend for the MVP; do not add chat persistence unless separately approved.
- [ ] Bound message/history sizes and return concise errors for malformed model output or provider failure.

### Tests

- Schema tests: reply-only, single operation, and multiple-operation structured responses parse; unknown operation shapes fail.
- Prompt/request tests with a fake OpenAI client: current database board, user message, and conversation history are included.
- Operation tests: create, edit, same-column reorder, cross-column move, and ordered multi-card changes.
- Safety tests: unknown card/column, mismatched ownership, invalid fixed-column changes, and one invalid operation in a batch cause no database mutation.
- API tests: reply-only response leaves the board unchanged; mutation response returns the updated board; provider/malformed-output failures are safe and do not leak internals.

### Success criteria

- A single chat request can safely create, edit, or move one or more cards.
- The model receives the authoritative current board and bounded conversation context.
- Model output cannot bypass user ownership, fixed-column rules, or transactional validation.
- Reply-only chats do not write to the database.
- All Part 9 tests pass and the user approves moving to Part 10.

## Part 10: AI chat sidebar

### Goal

Add a polished, accessible AI chat sidebar that maintains the current conversation and immediately reflects AI board changes.

### Checklist

- [ ] Design the sidebar within the existing color system and board layout, with a usable responsive treatment for narrow screens.
- [ ] Add chat open/close behavior if required by the responsive layout.
- [ ] Render user and assistant messages with readable roles and an empty-state prompt.
- [ ] Add an accessible composer with submit, disabled/loading state, keyboard behavior, and concise errors.
- [ ] Send the current user message and bounded session-local history to the Part 9 endpoint.
- [ ] Prevent duplicate sends while a request is in flight.
- [ ] Append successful responses to the conversation without persisting chat to SQLite.
- [ ] When the response changes the board, replace visible state with the returned canonical board or immediately refetch it.
- [ ] Preserve the conversation when the board refreshes during the current page session.
- [ ] Verify the sidebar does not break board drag/drop, editing, or scrolling.
- [ ] Complete final documentation for setup, OpenAI configuration, start/stop, tests, data persistence, and MVP limitations.
- [ ] Run the complete project verification suite in the production container configuration.

### Tests

- Component tests: empty state, send flow, loading/disabled behavior, reply rendering, error recovery, and bounded history sent on the next turn.
- Component/integration tests: reply-only response does not refresh board state; mutation response immediately updates it.
- Backend-integrated browser tests with a deterministic fake AI: create, edit, move, and multi-card requests update both chat and board.
- Regression browser tests: manual board actions still work with the sidebar open; authentication/logout clears session-local chat; responsive layout remains usable.
- Optional live smoke test: send a harmless board request through the full UI using OpenAI and verify the persisted result.
- Full checks: backend tests, frontend lint/unit/build tests, Playwright suite, Docker build, health/static smoke tests, and restart-persistence test.

### Success criteria

- A signed-in user can hold a multi-turn chat during the current browser session.
- The assistant can reply without changing the board or can create, edit, and move one or more cards.
- AI changes appear automatically and match the persisted database state.
- The final application runs locally in one Docker container using the provided platform scripts.
- All automated tests pass, the opt-in live test is reported separately, and the user accepts the completed MVP.
