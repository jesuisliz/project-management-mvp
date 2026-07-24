import type { BoardData, BoardSummary } from "@/lib/kanban";
import type { ChatMessage } from "@/lib/chat";

export type SessionPayload = {
  authenticated: boolean;
  username: string | null;
};

export type ChatResponse = {
  reply: string;
  boardChanged: boolean;
  board?: BoardData;
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: init?.body
      ? { "Content-Type": "application/json", ...init.headers }
      : init?.headers,
  });
  let payload: (T & { detail?: string }) | undefined;
  try {
    payload = (await response.json()) as T & { detail?: string };
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.detail ?? response.statusText ?? "Request failed"
    );
  }
  if (payload === undefined) {
    throw new ApiError(response.status, "Unexpected empty response");
  }
  return payload;
};

export const sessionApi = {
  current: () => request<SessionPayload>("/api/auth/session"),
  login: (username: string, password: string) =>
    request<SessionPayload>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  register: (username: string, password: string) =>
    request<SessionPayload>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () =>
    request<SessionPayload>("/api/auth/logout", { method: "POST" }),
};

export const boardsApi = {
  list: () => request<BoardSummary[]>("/api/boards"),
  create: (name: string) =>
    request<BoardSummary>("/api/boards", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  rename: (boardId: number, name: string) =>
    request<BoardSummary>(`/api/boards/${boardId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  delete: (boardId: number) =>
    request<BoardSummary[]>(`/api/boards/${boardId}`, { method: "DELETE" }),
};

export const boardApi = {
  get: (boardId: number) => request<BoardData>(`/api/boards/${boardId}`),
  renameColumn: (boardId: number, columnId: string, title: string) =>
    request<BoardData>(
      `/api/boards/${boardId}/columns/${encodeURIComponent(columnId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ title }),
      }
    ),
  createCard: (
    boardId: number,
    columnId: string,
    title: string,
    details: string
  ) =>
    request<BoardData>(`/api/boards/${boardId}/cards`, {
      method: "POST",
      body: JSON.stringify({ columnId, title, details }),
    }),
  editCard: (boardId: number, cardId: string, title: string, details: string) =>
    request<BoardData>(
      `/api/boards/${boardId}/cards/${encodeURIComponent(cardId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ title, details }),
      }
    ),
  deleteCard: (boardId: number, cardId: string) =>
    request<BoardData>(
      `/api/boards/${boardId}/cards/${encodeURIComponent(cardId)}`,
      { method: "DELETE" }
    ),
  moveCard: (
    boardId: number,
    cardId: string,
    columnId: string,
    position: number
  ) =>
    request<BoardData>(
      `/api/boards/${boardId}/cards/${encodeURIComponent(cardId)}/move`,
      {
        method: "POST",
        body: JSON.stringify({ columnId, position }),
      }
    ),
  setCardLabels: (boardId: number, cardId: string, labelIds: string[]) =>
    request<BoardData>(
      `/api/boards/${boardId}/cards/${encodeURIComponent(cardId)}/labels`,
      {
        method: "PUT",
        body: JSON.stringify({ labelIds }),
      }
    ),
  createLabel: (boardId: number, name: string, color: string) =>
    request<BoardData>(`/api/boards/${boardId}/labels`, {
      method: "POST",
      body: JSON.stringify({ name, color }),
    }),
  renameLabel: (
    boardId: number,
    labelId: string,
    name: string,
    color: string
  ) =>
    request<BoardData>(
      `/api/boards/${boardId}/labels/${encodeURIComponent(labelId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ name, color }),
      }
    ),
  deleteLabel: (boardId: number, labelId: string) =>
    request<BoardData>(
      `/api/boards/${boardId}/labels/${encodeURIComponent(labelId)}`,
      { method: "DELETE" }
    ),
};

export const chatApi = {
  send: (boardId: number, message: string, history: ChatMessage[]) =>
    request<ChatResponse>(`/api/boards/${boardId}/ai/chat`, {
      method: "POST",
      body: JSON.stringify({ message, history }),
    }),
};
