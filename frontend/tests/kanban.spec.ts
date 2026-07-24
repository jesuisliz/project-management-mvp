import { expect, test, type Locator, type Page } from "@playwright/test";
import { cloneBoard } from "../src/test/boardFixture";
import type { BoardData } from "../src/lib/kanban";

const BOARD_ID = 1;

test.beforeEach(async ({ page }) => {
  if (process.env.PLAYWRIGHT_BASE_URL) return;

  let authenticated = false;
  let nextCardId = 1;
  let nextBoardId = 2;
  let nextLabelId = 1;
  const boards = [{ id: BOARD_ID, name: "My Board" }];
  const boardData: Record<number, BoardData> = { [BOARD_ID]: cloneBoard() };
  const emptyColumns = cloneBoard().columns.map((column) => ({
    id: column.id,
    title: column.title,
    cardIds: [] as string[],
  }));
  const emptyBoard = (): BoardData => ({
    columns: emptyColumns.map((column) => ({ ...column, cardIds: [] })),
    cards: {},
    labels: [],
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;

    if (path === "/api/auth/session") {
      await route.fulfill({
        json: {
          authenticated,
          username: authenticated ? "user" : null,
        },
      });
      return;
    }
    if (path === "/api/auth/login") {
      const credentials = request.postDataJSON() as {
        username: string;
        password: string;
      };
      authenticated =
        credentials.username === "user" && credentials.password === "password";
      await route.fulfill({
        status: authenticated ? 200 : 401,
        json: authenticated
          ? { authenticated: true, username: "user" }
          : { detail: "Invalid username or password" },
      });
      return;
    }
    if (path === "/api/auth/logout") {
      authenticated = false;
      await route.fulfill({
        json: { authenticated: false, username: null },
      });
      return;
    }

    if (!authenticated) {
      await route.fulfill({
        status: 401,
        json: { detail: "Authentication required" },
      });
      return;
    }

    if (path === "/api/boards" && method === "GET") {
      await route.fulfill({ json: boards });
      return;
    }
    if (path === "/api/boards" && method === "POST") {
      const { name } = request.postDataJSON() as { name: string };
      const id = nextBoardId++;
      boards.push({ id, name });
      boardData[id] = emptyBoard();
      await route.fulfill({ status: 201, json: { id, name } });
      return;
    }

    const boardIdMatch = path.match(/^\/api\/boards\/(\d+)(.*)$/);
    if (!boardIdMatch) {
      await route.fallback();
      return;
    }
    const boardId = Number(boardIdMatch[1]);
    const subPath = boardIdMatch[2];
    const board = boardData[boardId];

    if (subPath === "" && method === "GET") {
      await route.fulfill({ json: board });
      return;
    }
    if (subPath === "" && method === "PATCH") {
      const { name } = request.postDataJSON() as { name: string };
      const entry = boards.find((candidate) => candidate.id === boardId);
      if (entry) entry.name = name;
      await route.fulfill({ json: { id: boardId, name } });
      return;
    }
    if (subPath === "" && method === "DELETE") {
      const index = boards.findIndex((candidate) => candidate.id === boardId);
      if (index !== -1) boards.splice(index, 1);
      delete boardData[boardId];
      await route.fulfill({ json: boards });
      return;
    }

    if (subPath === "/ai/chat" && method === "POST") {
      const payload = request.postDataJSON() as {
        message: string;
        history: Array<{ role: "user" | "assistant"; content: string }>;
      };
      const message = payload.message.toLowerCase();
      let reply = "The board is ready for your next step.";
      let boardChanged = false;

      if (message.includes("create an ai launch card")) {
        const id = `card-playwright-${nextCardId++}`;
        board.cards[id] = {
          id,
          title: "AI launch card",
          details: "Created through chat.",
          labelIds: [],
        };
        board.columns[0].cardIds.push(id);
        reply = "I created the AI launch card in Backlog.";
        boardChanged = true;
      } else if (message.includes("edit the ai launch card")) {
        const card = Object.values(board.cards).find(
          (candidate) => candidate.title === "AI launch card"
        );
        if (card) {
          board.cards[card.id] = {
            ...card,
            title: "Edited AI launch card",
            details: "Edited through chat.",
          };
          boardChanged = true;
        }
        reply = "I edited the AI launch card.";
      } else if (message.includes("move the edited ai launch card")) {
        const card = Object.values(board.cards).find(
          (candidate) => candidate.title === "Edited AI launch card"
        );
        if (card) {
          board.columns = board.columns.map((column) => ({
            ...column,
            cardIds: column.cardIds.filter((id) => id !== card.id),
          }));
          const review = board.columns.find(
            (column) => column.id === "col-review"
          );
          review?.cardIds.unshift(card.id);
          boardChanged = true;
        }
        reply = "I moved the edited AI launch card to Review.";
      } else if (message.includes("create two follow-up cards")) {
        for (const title of ["AI follow-up one", "AI follow-up two"]) {
          const id = `card-playwright-${nextCardId++}`;
          board.cards[id] = {
            id,
            title,
            details: "Created in one request.",
            labelIds: [],
          };
          board.columns[0].cardIds.push(id);
        }
        reply = "I created both follow-up cards.";
        boardChanged = true;
      } else if (message.includes("follow up on that")) {
        reply = `I received ${payload.history.length} prior messages.`;
      }

      await route.fulfill({
        json: {
          reply,
          boardChanged,
          ...(boardChanged ? { board } : {}),
        },
      });
      return;
    }

    const columnMatch = subPath.match(/^\/columns\/([^/]+)$/);
    if (columnMatch && method === "PATCH") {
      const { title } = request.postDataJSON() as { title: string };
      board.columns = board.columns.map((column) =>
        column.id === decodeURIComponent(columnMatch[1])
          ? { ...column, title }
          : column
      );
      await route.fulfill({ json: board });
      return;
    }

    if (subPath === "/cards" && method === "POST") {
      const payload = request.postDataJSON() as {
        columnId: string;
        title: string;
        details: string;
      };
      const id = `card-playwright-${nextCardId++}`;
      board.cards[id] = {
        id,
        title: payload.title,
        details: payload.details,
        labelIds: [],
      };
      board.columns = board.columns.map((column) =>
        column.id === payload.columnId
          ? { ...column, cardIds: [...column.cardIds, id] }
          : column
      );
      await route.fulfill({ status: 201, json: board });
      return;
    }

    const moveMatch = subPath.match(/^\/cards\/([^/]+)\/move$/);
    if (moveMatch && method === "POST") {
      const cardId = decodeURIComponent(moveMatch[1]);
      const payload = request.postDataJSON() as {
        columnId: string;
        position: number;
      };
      board.columns = board.columns.map((column) => ({
        ...column,
        cardIds: column.cardIds.filter((id) => id !== cardId),
      }));
      board.columns = board.columns.map((column) => {
        if (column.id !== payload.columnId) return column;
        const cardIds = [...column.cardIds];
        cardIds.splice(payload.position, 0, cardId);
        return { ...column, cardIds };
      });
      await route.fulfill({ json: board });
      return;
    }

    const labelsMatch = subPath.match(/^\/cards\/([^/]+)\/labels$/);
    if (labelsMatch && method === "PUT") {
      const cardId = decodeURIComponent(labelsMatch[1]);
      const { labelIds } = request.postDataJSON() as { labelIds: string[] };
      board.cards[cardId] = { ...board.cards[cardId], labelIds };
      await route.fulfill({ json: board });
      return;
    }

    if (subPath === "/labels" && method === "POST") {
      const { name, color } = request.postDataJSON() as {
        name: string;
        color: string;
      };
      const id = `label-${nextLabelId++}`;
      board.labels.push({ id, name, color });
      await route.fulfill({ status: 201, json: board });
      return;
    }

    const labelMatch = subPath.match(/^\/labels\/([^/]+)$/);
    if (labelMatch && method === "PATCH") {
      const labelId = decodeURIComponent(labelMatch[1]);
      const { name, color } = request.postDataJSON() as {
        name: string;
        color: string;
      };
      board.labels = board.labels.map((label) =>
        label.id === labelId ? { id: labelId, name, color } : label
      );
      await route.fulfill({ json: board });
      return;
    }
    if (labelMatch && method === "DELETE") {
      const labelId = decodeURIComponent(labelMatch[1]);
      board.labels = board.labels.filter((label) => label.id !== labelId);
      for (const card of Object.values(board.cards)) {
        card.labelIds = card.labelIds.filter((id) => id !== labelId);
      }
      await route.fulfill({ json: board });
      return;
    }

    const cardMatch = subPath.match(/^\/cards\/([^/]+)$/);
    if (cardMatch && method === "PATCH") {
      const cardId = decodeURIComponent(cardMatch[1]);
      const payload = request.postDataJSON() as {
        title: string;
        details: string;
      };
      board.cards[cardId] = {
        ...board.cards[cardId],
        id: cardId,
        ...payload,
      };
      await route.fulfill({ json: board });
      return;
    }
    if (cardMatch && method === "DELETE") {
      const cardId = decodeURIComponent(cardMatch[1]);
      delete board.cards[cardId];
      board.columns = board.columns.map((column) => ({
        ...column,
        cardIds: column.cardIds.filter((id) => id !== cardId),
      }));
      await route.fulfill({ json: board });
      return;
    }

    await route.fallback();
  });
});

const signIn = async (page: Page) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
};

const dragCard = async (page: Page, card: Locator, target: Locator) => {
  const handle = card.getByRole("button", { name: /^Drag / });
  const handleBox = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  const targetTestId = await target.getAttribute("data-testid");
  if (!handleBox || !targetBox) throw new Error("Unable to resolve drag coordinates.");

  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox.x + handleBox.width / 2 + 10,
    handleBox.y + handleBox.height / 2,
    { steps: 4 }
  );
  await page.mouse.move(
    targetBox.x + targetBox.width - 16,
    targetBox.y + (targetTestId?.startsWith("column-") ? 120 : 16),
    { steps: 12 }
  );
  await page.mouse.up();
  await expect(page.getByRole("status")).toContainText("was dropped over");
};

const expectCardOrder = async (column: Locator, ids: string[]) => {
  await expect
    .poll(() =>
      column.locator('[data-testid^="card-"]').evaluateAll((cards) =>
        cards.map((card) => card.getAttribute("data-testid")?.replace("card-", ""))
      )
    )
    .toEqual(ids);
};

test("anonymous users see sign in instead of the board", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeHidden();
});

test("invalid credentials do not open the board", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("Invalid username or password.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeHidden();
});

test("valid credentials persist the session across reloads", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText("Signed in as")).toContainText("user");

  const browserState = await page.evaluate(() => ({
    localStorageValues: Object.values(localStorage),
    sessionStorageValues: Object.values(sessionStorage),
    visibleCookies: document.cookie,
  }));
  expect(
    [...browserState.localStorageValues, ...browserState.sessionStorageValues].some(
      (value) => value.includes("password")
    )
  ).toBe(false);
  expect(browserState.visibleCookies).toBe("");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
});

test("logout hides the board and ends the session", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Log out" }).click();

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("loads the five-column server board", async ({ page }) => {
  await signIn(page);
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
});

test("opens chat by default on desktop and supports collapse", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await signIn(page);

  await expect(page.getByRole("complementary", { name: "AI assistant" })).toBeVisible();
  await page.getByRole("button", { name: "Close AI assistant" }).click();
  await expect(page.getByRole("complementary", { name: "AI assistant" })).toBeHidden();
  await page.getByRole("button", { name: "Open AI Assistant" }).click();
  await expect(page.getByLabel("Message AI assistant")).toBeFocused();
});

test("keeps chat closed by default on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await signIn(page);

  await expect(page.getByRole("complementary", { name: "AI assistant" })).toBeHidden();
  await page.getByRole("button", { name: "Open AI Assistant" }).click();
  await expect(page.getByRole("complementary", { name: "AI assistant" })).toBeVisible();
  await page.getByRole("button", { name: "Close AI assistant" }).click();
  await expect(page.getByRole("complementary", { name: "AI assistant" })).toBeHidden();
});

test("keeps all five columns even and visible at laptop width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);

  await expect(page.getByRole("complementary", { name: "AI assistant" })).toBeHidden();
  const columns = page.locator('[data-testid^="column-"]');
  await expect(columns).toHaveCount(5);
  const boxes = await columns.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width };
    })
  );
  const widths = boxes.map((box) => box.width);

  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
  expect(boxes[0].left).toBeGreaterThanOrEqual(24);
  expect(boxes[4].right).toBeLessThanOrEqual(1440 - 24);
});

test("holds a multi-turn chat and applies AI card changes", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Open AI Assistant" }).click();
  const composer = page.getByLabel("Message AI assistant");

  await composer.fill("What is on the board?");
  await composer.press("Enter");
  await expect(page.getByText("The board is ready for your next step.")).toBeVisible();

  await composer.fill("Follow up on that");
  await composer.press("Enter");
  await expect(page.getByText("I received 2 prior messages.")).toBeVisible();

  await composer.fill("Create an AI launch card");
  await composer.press("Enter");
  await expect(page.getByText("AI launch card", { exact: true })).toBeVisible();

  await composer.fill("Edit the AI launch card");
  await composer.press("Enter");
  await expect(page.getByText("Edited AI launch card", { exact: true })).toBeVisible();

  await composer.fill("Move the edited AI launch card to Review");
  await composer.press("Enter");
  await expect(
    page.getByTestId("column-col-review").getByText("Edited AI launch card")
  ).toBeVisible();

  await composer.fill("Create two follow-up cards");
  await composer.press("Enter");
  await expect(page.getByText("AI follow-up one")).toBeVisible();
  await expect(page.getByText("AI follow-up two")).toBeVisible();

  await page.evaluate(async (boardId) => {
    const boardResponse = await fetch(`/api/boards/${boardId}`);
    const board = (await boardResponse.json()) as {
      cards: Record<string, { title: string }>;
    };
    const aiCardIds = Object.entries(board.cards)
      .filter(([, card]) => card.title.toLowerCase().includes("ai "))
      .map(([cardId]) => cardId);
    for (const cardId of aiCardIds) {
      const response = await fetch(`/api/boards/${boardId}/cards/${cardId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Unable to remove AI browser-test card");
    }
  }, BOARD_ID);
});

test("logout clears the session-local conversation", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Open AI Assistant" }).click();
  const composer = page.getByLabel("Message AI assistant");
  await composer.fill("What is on the board?");
  await composer.press("Enter");
  await expect(page.getByText("The board is ready for your next step.")).toBeVisible();

  await page.getByRole("button", { name: "Close AI assistant" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await signIn(page);
  await page.getByRole("button", { name: "Open AI Assistant" }).click();

  await expect(page.getByText("What should we change?")).toBeVisible();
  await expect(page.getByText("The board is ready for your next step.")).toBeHidden();
});

test("renames a column and persists across reload", async ({ page }) => {
  await signIn(page);
  const firstColumn = page.getByTestId("column-col-backlog");
  const title = firstColumn.getByLabel("Column title");
  const originalTitle = await title.inputValue();

  await title.fill("Validated Backlog");
  await title.press("Tab");
  await expect(title).toHaveValue("Validated Backlog");
  await page.reload();
  await expect(page.getByTestId("column-col-backlog").getByLabel("Column title")).toHaveValue(
    "Validated Backlog"
  );

  const restoredTitle = page.getByTestId("column-col-backlog").getByLabel("Column title");
  await restoredTitle.fill(originalTitle);
  await restoredTitle.press("Tab");
  await expect(restoredTitle).toHaveValue(originalTitle);
});

test("adds, edits, reloads, logs in again, and deletes a card", async ({ page }) => {
  await signIn(page);
  let backlog = page.getByTestId("column-col-backlog");
  await backlog.getByRole("button", { name: /add a card/i }).click();
  await backlog.getByPlaceholder("Card title").fill("Playwright card");
  await backlog.getByPlaceholder("Details").fill("Added via browser test.");
  await backlog.getByRole("button", { name: "Add card" }).click();

  await backlog.getByRole("button", { name: "Edit Playwright card" }).click();
  const cardArticle = backlog.locator("article", { has: page.getByLabel("Title") });
  await cardArticle.getByLabel("Title").fill("Edited Playwright card");
  await cardArticle.getByLabel("Details").fill("Edited and persisted.");
  await cardArticle.getByRole("button", { name: "Save" }).click();
  await expect(backlog.getByText("Edited Playwright card")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Edited Playwright card")).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await signIn(page);
  await expect(page.getByText("Edited Playwright card")).toBeVisible();

  backlog = page.getByTestId("column-col-backlog");
  await backlog.getByRole("button", { name: "Delete Edited Playwright card" }).click();
  await expect(page.getByText("Edited Playwright card")).toBeHidden();
  await page.reload();
  await expect(page.getByText("Edited Playwright card")).toBeHidden();
});

test("reorders a card and persists across reload", async ({ page }) => {
  await signIn(page);
  let backlog = page.getByTestId("column-col-backlog");
  await dragCard(page, page.getByTestId("card-card-1"), page.getByTestId("card-card-2"));
  await expectCardOrder(backlog, ["card-2", "card-1"]);
  await page.reload();
  backlog = page.getByTestId("column-col-backlog");
  await expectCardOrder(backlog, ["card-2", "card-1"]);

  await page.evaluate(async (boardId) => {
    const response = await fetch(`/api/boards/${boardId}/cards/card-1/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnId: "col-backlog", position: 0 }),
    });
    if (!response.ok) throw new Error("Unable to restore card order");
  }, BOARD_ID);
  await page.reload();
  backlog = page.getByTestId("column-col-backlog");
  await expectCardOrder(backlog, ["card-1", "card-2"]);
});

test("moves a card between columns and persists across reload", async ({ page }) => {
  await signIn(page);
  const review = page.getByTestId("column-col-review");
  await dragCard(page, page.getByTestId("card-card-1"), review);
  await expect(review.getByTestId("card-card-1")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("column-col-review").getByTestId("card-card-1")).toBeVisible();

  await page.evaluate(async (boardId) => {
    const response = await fetch(`/api/boards/${boardId}/cards/card-1/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnId: "col-backlog", position: 0 }),
    });
    if (!response.ok) throw new Error("Unable to restore card column");
  }, BOARD_ID);
  await page.reload();
  const backlog = page.getByTestId("column-col-backlog");
  await expectCardOrder(backlog, ["card-1", "card-2"]);
});

test("creates, switches to, renames, and deletes a board", async ({ page }) => {
  await signIn(page);

  await page.getByRole("button", { name: "New board" }).click();
  await page.getByLabel("New board name").fill("Second board");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Align roadmap themes")).toBeHidden();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);

  await page.getByRole("button", { name: "Rename board" }).click();
  await page.getByLabel("Board name").fill("Renamed board");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Select a board")).toHaveValue("2");

  await page.getByLabel("Select a board").selectOption({ label: "My Board" });
  await expect(page.getByText("Align roadmap themes")).toBeVisible();

  await page.getByLabel("Select a board").selectOption({ label: "Renamed board" });
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete board" }).click();
  await expect(page.getByLabel("Select a board")).toHaveValue("1");
});

test("creates a label and assigns then removes it from a card", async ({ page }) => {
  await signIn(page);

  await page.getByRole("button", { name: "+ Label" }).click();
  await page.getByLabel("New label name").fill("Urgent");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Urgent label" })).toBeVisible();

  const card = page.getByTestId("card-card-1");
  const labelToggle = card.getByRole("button", { name: /manage labels/i });
  await labelToggle.click();
  await page.getByRole("checkbox", { name: "Urgent" }).click();
  await labelToggle.click();
  await expect(card.locator("span", { hasText: "Urgent" })).toBeVisible();

  await labelToggle.click();
  await page.getByRole("checkbox", { name: "Urgent" }).click();
  await labelToggle.click();
  await expect(card.locator("span", { hasText: "Urgent" })).toBeHidden();
});
