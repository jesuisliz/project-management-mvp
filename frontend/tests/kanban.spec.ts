import { expect, test, type Locator, type Page } from "@playwright/test";
import { cloneBoard } from "../src/test/boardFixture";

test.beforeEach(async ({ page }) => {
  if (process.env.PLAYWRIGHT_BASE_URL) return;

  let authenticated = false;
  const board = cloneBoard();
  let nextCardId = 1;

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
    if (path === "/api/board" && method === "GET") {
      await route.fulfill({ json: board });
      return;
    }

    const columnMatch = path.match(/^\/api\/board\/columns\/([^/]+)$/);
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

    if (path === "/api/board/cards" && method === "POST") {
      const payload = request.postDataJSON() as {
        columnId: string;
        title: string;
        details: string;
      };
      const id = `card-playwright-${nextCardId++}`;
      board.cards[id] = { id, title: payload.title, details: payload.details };
      board.columns = board.columns.map((column) =>
        column.id === payload.columnId
          ? { ...column, cardIds: [...column.cardIds, id] }
          : column
      );
      await route.fulfill({ status: 201, json: board });
      return;
    }

    const moveMatch = path.match(/^\/api\/board\/cards\/([^/]+)\/move$/);
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

    const cardMatch = path.match(/^\/api\/board\/cards\/([^/]+)$/);
    if (cardMatch && method === "PATCH") {
      const cardId = decodeURIComponent(cardMatch[1]);
      const payload = request.postDataJSON() as {
        title: string;
        details: string;
      };
      board.cards[cardId] = { id: cardId, ...payload };
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

  await page.evaluate(async () => {
    const response = await fetch("/api/board/cards/card-1/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnId: "col-backlog", position: 0 }),
    });
    if (!response.ok) throw new Error("Unable to restore card order");
  });
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

  await page.evaluate(async () => {
    const response = await fetch("/api/board/cards/card-1/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnId: "col-backlog", position: 0 }),
    });
    if (!response.ok) throw new Error("Unable to restore card column");
  });
  await page.reload();
  const backlog = page.getByTestId("column-col-backlog");
  await expectCardOrder(backlog, ["card-1", "card-2"]);
});
