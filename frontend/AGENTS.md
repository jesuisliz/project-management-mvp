# Frontend guide

## Scope

This directory contains the Kanban frontend. It is a statically exported Next.js App Router application written in TypeScript and served by FastAPI. Until the backend integration phases, board state is held only in React memory and resets on page reload.

Follow the project-wide requirements in the root `AGENTS.md` in addition to this file.

## Stack

- Next.js 16 with React 19 and the App Router
- TypeScript in strict mode with the `@/*` alias mapped to `src/*`
- Tailwind CSS 4, with project colors exposed as CSS custom properties in `src/app/globals.css`
- `@dnd-kit` for sortable cards and cross-column drag and drop
- Vitest, jsdom, and Testing Library for unit/component tests
- Playwright with Chromium for browser tests

Use npm and keep `package-lock.json` in sync with `package.json`.

## Structure

- `src/app/layout.tsx`: root layout, metadata, and font setup
- `src/app/page.tsx`: renders the single `KanbanBoard`
- `src/app/globals.css`: global styles, Tailwind import, and color tokens
- `src/components/KanbanBoard.tsx`: client-side board state and board operations
- `src/components/KanbanColumn.tsx`: droppable column, editable title, cards, and add-card form
- `src/components/KanbanCard.tsx`: sortable card and remove action
- `src/components/KanbanCardPreview.tsx`: drag overlay presentation
- `src/components/NewCardForm.tsx`: local add-card form state and validation
- `src/lib/kanban.ts`: board types, demo data, ID creation, and pure card-movement logic
- `src/**/*.test.ts(x)`: Vitest unit and component tests
- `tests/*.spec.ts`: Playwright browser tests
- `out/`: generated production export; do not edit or commit it

## Current behavior

The demo renders one board with five fixed columns. A user can:

- rename a column inline;
- add a card with a required title and optional details;
- remove a card; and
- reorder cards or move them between columns with drag and drop.

The frontend does not yet provide authentication, persistence, API calls, card editing, AI chat, or error/loading states. Do not treat the hardcoded data in `src/lib/kanban.ts` as a database contract; the database design will be approved separately.

## Conventions

- Keep state transformations immutable.
- Put data-only types and pure board operations in `src/lib/kanban.ts`; keep rendering and browser interactions in components.
- Preserve stable column and card IDs because drag and drop and tests use them.
- Keep the column count fixed unless the root requirements change. Renaming a column must not change its ID.
- Reuse the CSS color variables from `globals.css` rather than introducing competing color values.
- Use accessible labels and roles for interactive controls. Tests should prefer those selectors; `data-testid` is appropriate for drag/drop identities and column/card containment.
- Keep client components limited to files that need state, effects, or browser event handling.
- Keep the application compatible with `output: "export"`; do not add runtime Next.js server dependencies.
- Do not add features from a later part of `docs/PLAN.md` early.

## Verification

Run from this directory:

```bash
npm run lint
npm run test:unit
npm run build
npm run test:e2e
```

Add or update focused unit/component tests for state and UI changes. Add Playwright coverage for user-visible workflows that cross component or API boundaries.
