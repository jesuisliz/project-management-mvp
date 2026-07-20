import { ApiError, boardApi, chatApi } from "@/lib/api";
import { cloneBoard } from "@/test/boardFixture";

const mockResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  }) as unknown as Response;

describe("boardApi", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(mockResponse(cloneBoard()));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["read", () => boardApi.get(), "/api/board", undefined],
    [
      "rename",
      () => boardApi.renameColumn("col-backlog", "Ready"),
      "/api/board/columns/col-backlog",
      { method: "PATCH", body: JSON.stringify({ title: "Ready" }) },
    ],
    [
      "create",
      () => boardApi.createCard("col-backlog", "Card", "Details"),
      "/api/board/cards",
      {
        method: "POST",
        body: JSON.stringify({
          columnId: "col-backlog",
          title: "Card",
          details: "Details",
        }),
      },
    ],
    [
      "edit",
      () => boardApi.editCard("card-1", "Card", "Details"),
      "/api/board/cards/card-1",
      {
        method: "PATCH",
        body: JSON.stringify({ title: "Card", details: "Details" }),
      },
    ],
    [
      "delete",
      () => boardApi.deleteCard("card-1"),
      "/api/board/cards/card-1",
      { method: "DELETE" },
    ],
    [
      "move",
      () => boardApi.moveCard("card-1", "col-review", 1),
      "/api/board/cards/card-1/move",
      {
        method: "POST",
        body: JSON.stringify({ columnId: "col-review", position: 1 }),
      },
    ],
  ])("sends the %s request and consumes the canonical board", async (_, call, path, init) => {
    await expect(call()).resolves.toEqual(cloneBoard());

    expect(fetchMock).toHaveBeenCalledWith(
      path,
      expect.objectContaining({
        ...init,
        credentials: "same-origin",
      })
    );
  });

  it("exposes unauthorized responses to the application", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ detail: "Authentication required" }, 401)
    );

    await expect(boardApi.get()).rejects.toEqual(
      new ApiError(401, "Authentication required")
    );
  });

  it("sends the current message and conversation history to chat", async () => {
    const response = {
      reply: "The board is on track.",
      boardChanged: false,
    };
    fetchMock.mockResolvedValueOnce(mockResponse(response));
    const history = [
      { role: "user" as const, content: "What is in progress?" },
      { role: "assistant" as const, content: "Two cards." },
    ];

    await expect(chatApi.send("What is next?", history)).resolves.toEqual(
      response
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/ai/chat",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ message: "What is next?", history }),
      })
    );
  });
});
