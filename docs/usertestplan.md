# User Test Plan — Project Management Board

This guide is for anyone checking that the app works properly — no technical background needed. Just follow each numbered step, compare what you see to "What you should see," and tick the box.

## Before you start

1. Ask whoever set up the app for the web address to open (it usually looks like `http://localhost:8000`).
2. Open that address in your web browser (Chrome, Edge, Firefox, or Safari all work).
3. You will need these sign-in details for the shared demo account:
   - **Username:** `user`
   - **Password:** `password`
4. You can also create your own account from the sign-in screen — see Test 3 below.

If the page doesn't load at all, the app itself probably isn't running — ask whoever set it up to start it, then come back to step 2.

---

## Test 1 — Signing in with the correct details

**Steps:**
1. On the sign-in screen, make sure the **Sign in** tab (not "Create account") is selected.
2. Type `user` into the Username box.
3. Type `password` into the Password box.
4. Click the **Sign in** button.

**What you should see:** The screen changes to show a Kanban board titled "Kanban Studio," with your name ("user") shown near the top right.

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 2 — Signing in with the wrong password

**Steps:**
1. If you're signed in, click **Log out** first.
2. Type `user` into the Username box.
3. Type something wrong, like `wrongpassword`, into the Password box.
4. Click **Sign in**.

**What you should see:** You stay on the sign-in screen, and a message appears saying the username or password is invalid. You should **not** be let into the board.

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 3 — Creating your own account

**Steps:**
1. If you're signed in, log out first.
2. On the sign-in screen, click the **Create account** tab.
3. Type a new username you haven't used before, e.g. `tester1`.
4. Type any password, e.g. `testpassword123`.
5. Click **Create account**.

**What you should see:** You're taken straight into a brand-new board titled "Kanban Studio," signed in as the username you just picked. This board should be empty — five columns with no cards in them, since it's a fresh account.

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 4 — Trying to create an account with a username that's already taken

**Steps:**
1. Log out.
2. Click **Create account**.
3. Type `user` (the shared demo username) into the Username box.
4. Type any password.
5. Click **Create account**.

**What you should see:** You stay on the sign-in screen and see a message saying that username is already taken. You should **not** be let into any board.

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 5 — Looking at the board

**Steps:**
1. Sign in normally (Test 1).
2. Look at the main area of the screen.

**What you should see:** Near the top, a dropdown box showing the current board's name, along with buttons like **Rename board**, **New board**, and **Delete board**. Below that, a row labeled "Labels." Below that, five columns side by side, each with a name at the top (things like "Backlog," "Discovery," "In Progress," "Review," "Done" — the exact names may have been changed by someone else). Each column has one or more cards in it, and each card has a short title and some details text.

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 6 — Creating a second board

**Steps:**
1. Sign in.
2. Near the top, click **New board**.
3. Type a name, e.g. "Test board — please delete".
4. Click **Create**.

**What you should see:** The screen switches to a brand-new, empty board with that name — five columns, no cards. The dropdown near the top now shows your new board's name.

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 7 — Switching between boards

**Steps:**
1. With the test board from Test 6 open, click the board dropdown near the top.
2. Choose your original board (the one with the demo cards, likely named "My Board").

**What you should see:** The screen switches back and shows the original board's cards again. Switch back to the test board and confirm it's still empty.

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 8 — Renaming a board

**Steps:**
1. Switch to the test board you created in Test 6.
2. Click **Rename board**.
3. Clear the name and type a new one, e.g. "Renamed test board".
4. Click **Save**.

**What you should see:** The dropdown and the header immediately show the new name.

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 9 — Deleting a board

**Steps:**
1. Make sure the test board from Tests 6–8 is selected.
2. Click **Delete board**.
3. Confirm the pop-up that asks if you're sure.

**What you should see:** The test board disappears from the dropdown, and you're switched back to your other (original) board. This cleans up the test data from Tests 6–8.

**Bonus check:** Try clicking **Delete board** when you only have one board left (e.g. on a brand-new account from Test 3). The button should be greyed out / not clickable, since every account must keep at least one board.

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 10 — Renaming a column

**Steps:**
1. Click into the name of any column (the text box at the top of the column).
2. Clear it and type a new name, e.g. "Testing 123".
3. Click somewhere else on the page (outside the box) or press Enter.
4. Reload the page (press F5 or click your browser's refresh button).

**What you should see:** The column keeps the new name you typed, even after reloading the page. Change it back to what it was before when you're done, so you don't leave test data behind.

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 11 — Adding a new card

**Steps:**
1. In any column, click the **Add a card** button near the bottom.
2. Type a title, e.g. "Test card — please delete".
3. Type a short description in the Details box.
4. Click **Add card**.

**What you should see:** The new card appears immediately at the bottom of that column, with the title and details you typed.

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 12 — Editing a card

**Steps:**
1. Find the test card you just created.
2. Click **Edit** on that card.
3. Change the title or details text.
4. Click **Save**.

**What you should see:** The card immediately shows your updated title/details.

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 13 — Moving a card by dragging

**Steps:**
1. Click and hold the small dotted "grip" icon on the test card (usually on the right side of the card).
2. Drag the card into a different column.
3. Let go.

**What you should see:** The card moves into the column you dropped it in, and stays there after reloading the page.

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 14 — Creating a label and adding it to a card

**Steps:**
1. In the "Labels" row near the top of the board, click **+ Label**.
2. Type a name, e.g. "Urgent".
3. Click one of the colored dots to pick a color.
4. Click **Add**.
5. Find your test card and click the small tag icon on it (it may be next to the edit and delete icons).
6. In the list that appears, tick the checkbox next to "Urgent".

**What you should see:** After step 4, the "Urgent" label appears as a colored chip in the Labels row. After step 6, a colored "Urgent" chip appears on the card itself, above its title.

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 15 — Removing a label from a card

**Steps:**
1. On the same test card, click the tag icon again.
2. Untick the checkbox next to "Urgent".

**What you should see:** The "Urgent" chip disappears from the card. The label itself still exists in the Labels row at the top — only the card's tag was removed.

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 16 — Deleting a label from the board

**Steps:**
1. In the Labels row near the top, find the "Urgent" label.
2. Click the small **×** next to it.

**What you should see:** The label disappears from the Labels row entirely. This cleans up the test data from Test 14. (If you had left it checked on any card, it would disappear from there too.)

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 17 — Removing the test card

**Steps:**
1. Find the test card.
2. Click **Remove** (sometimes shown as a trash icon or "Delete").

**What you should see:** The card disappears immediately and does not come back after reloading the page. This step cleans up the test data from Tests 11–15.

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 18 — Asking the AI Assistant a question

**Steps:**
1. Look for the **AI Assistant** panel on the right side of the screen. If you don't see it, click the **Open AI Assistant** button.
2. Click into the message box at the bottom of that panel.
3. Type a question, e.g. "What cards are in the Backlog column?"
4. Press Enter (or click **Send**).

**What you should see:** A short pause, then a reply from the assistant appears above your message, describing the board. The board itself does not change from just asking a question.

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 19 — Asking the AI Assistant to make a change

**Steps:**
1. In the same message box, type something like "Create a card called 'AI test card' in the Backlog column."
2. Press Enter.
3. Wait for the reply.

**What you should see:** The assistant replies confirming what it did, and the new card actually appears on the board in the column you asked for — without you needing to reload the page. This change only affects the board you currently have open.

**Cleanup:** Delete the card the assistant created (see Test 17) once you've confirmed it worked.

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 20 — Closing and reopening the assistant panel

**Steps:**
1. Click the **X** (close) button on the AI Assistant panel.
2. Click **Open AI Assistant** again.

**What you should see:** The panel closes, then reopens, and your earlier conversation with the assistant is still there (until you reload the page or log out).

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 21 — Staying signed in after a page reload

**Steps:**
1. While signed in, reload the page (F5).

**What you should see:** You stay signed in and see the same board again — you are **not** sent back to the sign-in screen.

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 22 — Logging out

**Steps:**
1. Click **Log out**.
2. Try reloading the page.

**What you should see:** You're taken back to the sign-in screen both immediately after logging out and after reloading — the board should not be visible until you sign in again.

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 23 — Trying to create a card with no title

**Steps:**
1. Sign in and click **Add a card** in any column.
2. Leave the title box empty.
3. Try clicking **Add card**.

**What you should see:** Nothing gets added — the app should stop you from creating a card without a title.

☐ Pass ☐ Fail — Notes: ______________________

---

## Test 24 — Typing an extremely long card title

**Steps:**
1. Click **Add a card**.
2. In the title box, try typing (or pasting) a very long piece of text — a few hundred characters or more.

**What you should see:** The box simply stops accepting more letters after a certain length, rather than letting you type an endless title.

☐ Pass ☐ Fail — Notes: ______________________

---

## Summary

| Total tests | Passed | Failed |
|---|---|---|
| 24 | ____ | ____ |

**Tester name:** ______________________
**Date:** ______________________
**Overall notes / anything that felt confusing or broken:**

______________________________________________________
______________________________________________________
______________________________________________________
