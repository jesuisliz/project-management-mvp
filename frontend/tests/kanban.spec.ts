import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  if (process.env.PLAYWRIGHT_BASE_URL) {
    return;
  }

  let authenticated = false;
  await page.route("**/api/auth/**", async (route) => {
    const request = route.request();
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

test("anonymous users see sign in instead of the board", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Kanban Studio" })
  ).toBeHidden();
});

test("invalid credentials do not open the board", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("Invalid username or password.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Kanban Studio" })
  ).toBeHidden();
});

test("valid credentials persist the session across reloads", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText("Signed in as")).toContainText("user");

  const browserState = await page.evaluate(() => ({
    localStorageValues: Object.values(localStorage),
    sessionStorageValues: Object.values(sessionStorage),
    visibleCookies: document.cookie,
  }));
  const storedValues = [
    ...browserState.localStorageValues,
    ...browserState.sessionStorageValues,
  ];
  expect(
    storedValues.some(
      (value) =>
        value === "user" ||
        value === "password" ||
        value.includes('"password":"password"')
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
  await expect(
    page.getByRole("heading", { name: "Kanban Studio" })
  ).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("loads the kanban board", async ({ page }) => {
  const fontStatuses: number[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith(".woff2")) {
      fontStatuses.push(response.status());
    }
  });
  await signIn(page);
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
  await page.evaluate(() => document.fonts.ready);
  expect(fontStatuses.length).toBeGreaterThan(0);
  expect(fontStatuses.every((status) => status === 200)).toBe(true);
});

test("renames a column", async ({ page }) => {
  await signIn(page);
  const firstColumn = page.locator('[data-testid^="column-"]').first();
  const title = firstColumn.getByLabel("Column title");
  await page.getByRole("button", { name: "Rename Backlog column" }).click();
  await expect(title).toBeFocused();
  await title.pressSequentially("TO DO");
  await title.press("Tab");
  await expect(title).toHaveValue("TO DO");
  await expect(
    page.getByRole("button", { name: "Rename TO DO column" })
  ).toBeVisible();
});

test("adds and removes a card", async ({ page }) => {
  await signIn(page);
  const firstColumn = page.locator('[data-testid^="column-"]').first();
  await firstColumn.getByRole("button", { name: /add a card/i }).click();
  await firstColumn.getByPlaceholder("Card title").fill("Playwright card");
  await firstColumn.getByPlaceholder("Details").fill("Added via e2e.");
  await firstColumn.getByRole("button", { name: /add card/i }).click();
  await expect(firstColumn.getByText("Playwright card")).toBeVisible();
  await firstColumn
    .getByRole("button", { name: "Delete Playwright card", exact: true })
    .click();
  await expect(firstColumn.getByText("Playwright card")).toBeHidden();
});

test("moves a card between columns", async ({ page }) => {
  await signIn(page);
  const card = page.getByTestId("card-card-1");
  const targetColumn = page.getByTestId("column-col-review");
  const cardBox = await card.boundingBox();
  const columnBox = await targetColumn.boundingBox();
  if (!cardBox || !columnBox) {
    throw new Error("Unable to resolve drag coordinates.");
  }

  await page.mouse.move(
    cardBox.x + cardBox.width / 2,
    cardBox.y + cardBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    columnBox.x + columnBox.width / 2,
    columnBox.y + 120,
    { steps: 12 }
  );
  await page.mouse.up();
  await expect(targetColumn.getByTestId("card-card-1")).toBeVisible();
});
