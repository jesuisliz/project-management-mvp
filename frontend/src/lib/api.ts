import type { BoardData } from "@/lib/kanban";

export type SessionPayload = {
  authenticated: boolean;
  username: string | null;
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
  const payload = (await response.json()) as T & { detail?: string };

  if (!response.ok) {
    throw new ApiError(response.status, payload.detail ?? "Request failed");
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
  logout: () =>
    request<SessionPayload>("/api/auth/logout", { method: "POST" }),
};

export const boardApi = {
  get: () => request<BoardData>("/api/board"),
  renameColumn: (columnId: string, title: string) =>
    request<BoardData>(`/api/board/columns/${encodeURIComponent(columnId)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  createCard: (columnId: string, title: string, details: string) =>
    request<BoardData>("/api/board/cards", {
      method: "POST",
      body: JSON.stringify({ columnId, title, details }),
    }),
  editCard: (cardId: string, title: string, details: string) =>
    request<BoardData>(`/api/board/cards/${encodeURIComponent(cardId)}`, {
      method: "PATCH",
      body: JSON.stringify({ title, details }),
    }),
  deleteCard: (cardId: string) =>
    request<BoardData>(`/api/board/cards/${encodeURIComponent(cardId)}`, {
      method: "DELETE",
    }),
  moveCard: (cardId: string, columnId: string, position: number) =>
    request<BoardData>(
      `/api/board/cards/${encodeURIComponent(cardId)}/move`,
      {
        method: "POST",
        body: JSON.stringify({ columnId, position }),
      }
    ),
};
