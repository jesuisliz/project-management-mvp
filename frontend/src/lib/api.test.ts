import { ApiError, boardApi, boardsApi, chatApi, sessionApi } from "@/lib/api";
import { cloneBoard } from "@/test/boardFixture";

const BOARD_ID = 1;

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
    ["read", () => boardApi.get(BOARD_ID), `/api/boards/${BOARD_ID}`, undefined],
    [
      "rename",
      () => boardApi.renameColumn(BOARD_ID, "col-backlog", "Ready"),
      `/api/boards/${BOARD_ID}/columns/col-backlog`,
      { method: "PATCH", body: JSON.stringify({ title: "Ready" }) },
    ],
    [
      "create",
      () => boardApi.createCard(BOARD_ID, "col-backlog", "Card", "Details"),
      `/api/boards/${BOARD_ID}/cards`,
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
      () => boardApi.editCard(BOARD_ID, "card-1", "Card", "Details"),
      `/api/boards/${BOARD_ID}/cards/card-1`,
      {
        method: "PATCH",
        body: JSON.stringify({ title: "Card", details: "Details" }),
      },
    ],
    [
      "delete",
      () => boardApi.deleteCard(BOARD_ID, "card-1"),
      `/api/boards/${BOARD_ID}/cards/card-1`,
      { method: "DELETE" },
    ],
    [
      "move",
      () => boardApi.moveCard(BOARD_ID, "card-1", "col-review", 1),
      `/api/boards/${BOARD_ID}/cards/card-1/move`,
      {
        method: "POST",
        body: JSON.stringify({ columnId: "col-review", position: 1 }),
      },
    ],
    [
      "set card labels",
      () => boardApi.setCardLabels(BOARD_ID, "card-1", ["label-1"]),
      `/api/boards/${BOARD_ID}/cards/card-1/labels`,
      { method: "PUT", body: JSON.stringify({ labelIds: ["label-1"] }) },
    ],
    [
      "create label",
      () => boardApi.createLabel(BOARD_ID, "Urgent", "#ecad0a"),
      `/api/boards/${BOARD_ID}/labels`,
      {
        method: "POST",
        body: JSON.stringify({ name: "Urgent", color: "#ecad0a" }),
      },
    ],
    [
      "rename label",
      () => boardApi.renameLabel(BOARD_ID, "label-1", "Blocked", "#753991"),
      `/api/boards/${BOARD_ID}/labels/label-1`,
      {
        method: "PATCH",
        body: JSON.stringify({ name: "Blocked", color: "#753991" }),
      },
    ],
    [
      "delete label",
      () => boardApi.deleteLabel(BOARD_ID, "label-1"),
      `/api/boards/${BOARD_ID}/labels/label-1`,
      { method: "DELETE" },
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

    await expect(boardApi.get(BOARD_ID)).rejects.toEqual(
      new ApiError(401, "Authentication required")
    );
  });

  it("surfaces a safe error when a failed response has no JSON body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected end of input")),
    } as unknown as Response);

    await expect(boardApi.get(BOARD_ID)).rejects.toEqual(
      new ApiError(500, "Internal Server Error")
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

    await expect(
      chatApi.send(BOARD_ID, "What is next?", history)
    ).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/boards/${BOARD_ID}/ai/chat`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ message: "What is next?", history }),
      })
    );
  });
});

describe("boardsApi", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("lists boards", async () => {
    const boards = [{ id: 1, name: "My Board" }];
    fetchMock.mockResolvedValueOnce(mockResponse(boards));

    await expect(boardsApi.list()).resolves.toEqual(boards);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/boards",
      expect.objectContaining({ credentials: "same-origin" })
    );
  });

  it("creates a board", async () => {
    const created = { id: 2, name: "Second board" };
    fetchMock.mockResolvedValueOnce(mockResponse(created, 201));

    await expect(boardsApi.create("Second board")).resolves.toEqual(created);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/boards",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Second board" }),
      })
    );
  });

  it("renames a board", async () => {
    const renamed = { id: 2, name: "Renamed" };
    fetchMock.mockResolvedValueOnce(mockResponse(renamed));

    await expect(boardsApi.rename(2, "Renamed")).resolves.toEqual(renamed);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/boards/2",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed" }),
      })
    );
  });

  it("deletes a board", async () => {
    const remaining = [{ id: 1, name: "My Board" }];
    fetchMock.mockResolvedValueOnce(mockResponse(remaining));

    await expect(boardsApi.delete(2)).resolves.toEqual(remaining);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/boards/2",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});

describe("sessionApi", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("registers a new account", async () => {
    const session = { authenticated: true, username: "newuser" };
    fetchMock.mockResolvedValueOnce(mockResponse(session));

    await expect(
      sessionApi.register("newuser", "s3cret")
    ).resolves.toEqual(session);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/auth/register",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ username: "newuser", password: "s3cret" }),
      })
    );
  });
});
