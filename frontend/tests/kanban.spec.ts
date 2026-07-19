import { expect, test } from "@playwright/test";

test("loads the kanban board", async ({ page }) => {
  const fontStatuses: number[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith(".woff2")) {
      fontStatuses.push(response.status());
    }
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
  await page.evaluate(() => document.fonts.ready);
  expect(fontStatuses.length).toBeGreaterThan(0);
  expect(fontStatuses.every((status) => status === 200)).toBe(true);
});

test("renames a column", async ({ page }) => {
  await page.goto("/");
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
  await page.goto("/");
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
  await page.goto("/");
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
