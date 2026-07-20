import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanBoard } from "@/components/KanbanBoard";
import { cloneBoard } from "@/test/boardFixture";

const mockResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  }) as unknown as Response;

const renderBoard = async (
  fetchMock: ReturnType<typeof vi.fn>,
  onUnauthorized = vi.fn()
) => {
  fetchMock.mockResolvedValueOnce(mockResponse(cloneBoard()));
  render(<KanbanBoard onUnauthorized={onUnauthorized} />);
  await screen.findByRole("heading", { name: "Kanban Studio" });
  return onUnauthorized;
};

describe("KanbanBoard", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("loads and renders the server board", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(cloneBoard()));

    render(<KanbanBoard onUnauthorized={vi.fn()} />);

    expect(screen.getByText("Loading your board...")).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Kanban Studio" })).toBeVisible();
    expect(screen.getAllByTestId(/column-/i)).toHaveLength(5);
  });

  it("shows an actionable load error and retries", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(mockResponse(cloneBoard()));
    render(<KanbanBoard onUnauthorized={vi.fn()} />);

    expect(
      await screen.findByRole("heading", { name: "Unable to load board" })
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  });

  it("renames a column from the confirmed response", async () => {
    await renderBoard(fetchMock);
    const updated = cloneBoard();
    updated.columns[0].title = "Ready";
    fetchMock.mockResolvedValueOnce(mockResponse(updated));
    const title = screen.getAllByLabelText("Column title")[0];

    await userEvent.clear(title);
    await userEvent.type(title, "Ready");
    await userEvent.tab();

    expect(
      await screen.findByRole("button", { name: "Rename Ready column" })
    ).toBeVisible();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/board/columns/col-backlog",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "Ready" }),
      })
    );
  });

  it("restores a column title when saving fails", async () => {
    await renderBoard(fetchMock);
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const title = screen.getAllByLabelText("Column title")[0];

    await userEvent.clear(title);
    await userEvent.type(title, "Unsaved");
    await userEvent.tab();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The saved title was restored"
    );
    expect(title).toHaveValue("Backlog");
  });

  it("creates a card from the confirmed response", async () => {
    await renderBoard(fetchMock);
    const updated = cloneBoard();
    updated.cards["card-new"] = {
      id: "card-new",
      title: "New card",
      details: "Notes",
    };
    updated.columns[0].cardIds.push("card-new");
    fetchMock.mockResolvedValueOnce(mockResponse(updated, 201));
    const column = screen.getAllByTestId(/column-/i)[0];

    await userEvent.click(within(column).getByRole("button", { name: /add a card/i }));
    await userEvent.type(within(column).getByPlaceholderText("Card title"), "New card");
    await userEvent.type(within(column).getByPlaceholderText("Details"), "Notes");
    await userEvent.click(within(column).getByRole("button", { name: "Add card" }));

    expect(await within(column).findByText("New card")).toBeVisible();
  });

  it("edits a card inline from the confirmed response", async () => {
    await renderBoard(fetchMock);
    const updated = cloneBoard();
    updated.cards["card-1"] = {
      id: "card-1",
      title: "Edited roadmap",
      details: "Edited details",
    };
    fetchMock.mockResolvedValueOnce(mockResponse(updated));
    const card = screen.getByTestId("card-card-1");

    await userEvent.click(within(card).getByRole("button", { name: /edit align roadmap/i }));
    const title = within(card).getByLabelText("Title");
    const details = within(card).getByLabelText("Details");
    await userEvent.clear(title);
    await userEvent.type(title, "Edited roadmap");
    await userEvent.clear(details);
    await userEvent.type(details, "Edited details");
    await userEvent.click(within(card).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Edited roadmap")).toBeVisible();
    expect(screen.getByText("Edited details")).toBeVisible();
  });

  it("deletes a card from the confirmed response", async () => {
    await renderBoard(fetchMock);
    const updated = cloneBoard();
    delete updated.cards["card-1"];
    updated.columns[0].cardIds = ["card-2"];
    fetchMock.mockResolvedValueOnce(mockResponse(updated));

    await userEvent.click(
      screen.getByRole("button", { name: "Delete Align roadmap themes" })
    );

    expect(screen.queryByText("Align roadmap themes")).not.toBeInTheDocument();
  });

  it("prevents overlapping mutations", async () => {
    await renderBoard(fetchMock);
    const updated = cloneBoard();
    delete updated.cards["card-1"];
    updated.columns[0].cardIds = ["card-2"];
    let finishDelete!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finishDelete = resolve;
      })
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Delete Align roadmap themes" })
    );

    expect(
      screen.getByRole("button", { name: "Delete Gather customer signals" })
    ).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    finishDelete(mockResponse(updated));
    await waitFor(() =>
      expect(screen.queryByText("Align roadmap themes")).not.toBeInTheDocument()
    );
  });

  it("returns to authentication after an unauthorized mutation", async () => {
    const onUnauthorized = await renderBoard(fetchMock, vi.fn());
    fetchMock.mockResolvedValueOnce(
      mockResponse({ detail: "Authentication required" }, 401)
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Delete Align roadmap themes" })
    );

    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("keeps reply-only chat in session memory without refreshing the board", async () => {
    await renderBoard(fetchMock);
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        reply: "The roadmap card is in Backlog.",
        boardChanged: false,
      })
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Open AI Assistant" })
    );
    await userEvent.type(
      screen.getByLabelText("Message AI assistant"),
      "Where is the roadmap card?"
    );
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("The roadmap card is in Backlog.")).toBeVisible();
    expect(screen.getByText("Where is the roadmap card?")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/ai/chat",
      expect.objectContaining({
        body: JSON.stringify({
          message: "Where is the roadmap card?",
          history: [],
        }),
      })
    );
  });

  it("sends successful prior turns as history on the next message", async () => {
    await renderBoard(fetchMock);
    fetchMock
      .mockResolvedValueOnce(
        mockResponse({ reply: "Two cards are in Backlog.", boardChanged: false })
      )
      .mockResolvedValueOnce(
        mockResponse({ reply: "Align roadmap themes.", boardChanged: false })
      );
    await userEvent.click(
      screen.getByRole("button", { name: "Open AI Assistant" })
    );
    const composer = screen.getByLabelText("Message AI assistant");

    await userEvent.type(composer, "How many cards are in Backlog?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Two cards are in Backlog.");
    await userEvent.type(composer, "Which should I do first?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Align roadmap themes.")).toBeVisible();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/ai/chat",
      expect.objectContaining({
        body: JSON.stringify({
          message: "Which should I do first?",
          history: [
            { role: "user", content: "How many cards are in Backlog?" },
            { role: "assistant", content: "Two cards are in Backlog." },
          ],
        }),
      })
    );
  });

  it("replaces the visible board after an AI mutation", async () => {
    await renderBoard(fetchMock);
    const updated = cloneBoard();
    updated.cards["card-ai"] = {
      id: "card-ai",
      title: "Prepare launch notes",
      details: "Created by the assistant.",
    };
    updated.columns[0].cardIds.push("card-ai");
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        reply: "I added the launch-notes card.",
        boardChanged: true,
        board: updated,
      })
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Open AI Assistant" })
    );

    await userEvent.type(
      screen.getByLabelText("Message AI assistant"),
      "Add a launch-notes card"
    );
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Prepare launch notes")).toBeVisible();
    expect(screen.getByText("I added the launch-notes card.")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows a concise chat error and returns to sign in on unauthorized chat", async () => {
    const onUnauthorized = await renderBoard(fetchMock, vi.fn());
    fetchMock.mockResolvedValueOnce(
      mockResponse({ detail: "OpenAI provider detail" }, 502)
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Open AI Assistant" })
    );
    const composer = screen.getByLabelText("Message AI assistant");

    await userEvent.type(composer, "Try this request");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not complete that request"
    );
    expect(screen.queryByText("OpenAI provider detail")).not.toBeInTheDocument();
    expect(composer).toHaveValue("Try this request");

    fetchMock.mockResolvedValueOnce(
      mockResponse({ detail: "Authentication required" }, 401)
    );
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledOnce());
  });
});
