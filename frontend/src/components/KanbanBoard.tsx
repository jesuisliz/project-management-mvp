"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { BoardSwitcher } from "@/components/BoardSwitcher";
import { ChatSidebar } from "@/components/ChatSidebar";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import { LabelManager } from "@/components/LabelManager";
import {
  ApiError,
  boardApi,
  boardsApi,
  chatApi,
} from "@/lib/api";
import { getBoundedChatHistory, type ChatMessage } from "@/lib/chat";
import {
  getCardDestination,
  type BoardData,
  type BoardSummary,
} from "@/lib/kanban";

const columnAccents = [
  "#209dd7",
  "#8b5cf6",
  "#ecad0a",
  "#f26b5b",
  "#16a085",
];

const desktopChatQuery = "(min-width: 1600px)";

const subscribeToDesktopLayout = (onChange: () => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(desktopChatQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

const getDesktopLayout = () =>
  typeof window !== "undefined" && Boolean(window.matchMedia?.(desktopChatQuery).matches);

type WorkspaceLoadResult =
  | { outcome: "success"; boards: BoardSummary[]; board: BoardData }
  | { outcome: "unauthorized" }
  | { outcome: "error" };

const fetchWorkspaceResult = async (): Promise<WorkspaceLoadResult> => {
  try {
    const boards = await boardsApi.list();
    const board = await boardApi.get(boards[0].id);
    return { outcome: "success", boards, board };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { outcome: "unauthorized" };
    }
    return { outcome: "error" };
  }
};

type KanbanBoardProps = {
  username?: string;
  onLogout?: () => void;
  onUnauthorized: () => void;
  isLoggingOut?: boolean;
  authError?: string | null;
};

export const KanbanBoard = ({
  username,
  onLogout,
  onUnauthorized,
  isLoggingOut = false,
  authError,
}: KanbanBoardProps) => {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<number | null>(null);
  const [board, setBoard] = useState<BoardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [activeCardWidth, setActiveCardWidth] = useState<number | null>(null);
  const [chatVisibility, setChatVisibility] = useState<boolean | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isChatSending, setIsChatSending] = useState(false);
  const mutationInFlight = useRef(false);
  const isDesktopLayout = useSyncExternalStore(
    subscribeToDesktopLayout,
    getDesktopLayout,
    () => false
  );
  const isChatOpen = chatVisibility ?? isDesktopLayout;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const applyWorkspaceResult = useCallback(
    (result: WorkspaceLoadResult) => {
      if (result.outcome === "success") {
        setBoards(result.boards);
        setSelectedBoardId(result.board ? result.boards[0].id : null);
        setBoard(result.board);
      } else if (result.outcome === "unauthorized") {
        onUnauthorized();
      } else {
        setLoadError("Unable to load your boards. Check the server and try again.");
      }
      setIsLoading(false);
    },
    [onUnauthorized]
  );

  useEffect(() => {
    let ignore = false;
    fetchWorkspaceResult().then((result) => {
      if (!ignore) applyWorkspaceResult(result);
    });
    return () => {
      ignore = true;
    };
  }, [applyWorkspaceResult]);

  const retryLoadWorkspace = () => {
    setIsLoading(true);
    setLoadError(null);
    void fetchWorkspaceResult().then(applyWorkspaceResult);
  };

  const cardsById = useMemo(() => board?.cards ?? {}, [board]);
  const labels = useMemo(() => board?.labels ?? [], [board]);

  const switchBoard = async (boardId: number) => {
    if (mutationInFlight.current) return;
    setSelectedBoardId(boardId);
    setIsLoading(true);
    setLoadError(null);
    setChatMessages([]);
    setChatError(null);
    try {
      setBoard(await boardApi.get(boardId));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized();
        return;
      }
      setLoadError("Unable to load that board. Check the server and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const runMutation = async (
    operation: () => Promise<BoardData>,
    errorMessage: string
  ): Promise<boolean> => {
    if (mutationInFlight.current) return false;

    mutationInFlight.current = true;
    setIsMutating(true);
    setMutationError(null);
    try {
      setBoard(await operation());
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized();
        return false;
      }
      setMutationError(errorMessage);
      return false;
    } finally {
      mutationInFlight.current = false;
      setIsMutating(false);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    if (!isMutating) {
      setActiveCardId(event.active.id as string);
      setActiveCardWidth(event.active.rect.current.initial?.width ?? null);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);
    setActiveCardWidth(null);

    if (!board || !selectedBoardId || !over || active.id === over.id || isMutating) {
      return;
    }
    const destination = getCardDestination(
      board.columns,
      active.id as string,
      over.id as string
    );
    if (!destination) return;

    void runMutation(
      () =>
        boardApi.moveCard(
          selectedBoardId,
          active.id as string,
          destination.columnId,
          destination.position
        ),
      "Unable to move the card. The saved board was not changed."
    );
  };

  const handleRenameColumn = (columnId: string, title: string) =>
    selectedBoardId
      ? runMutation(
          () => boardApi.renameColumn(selectedBoardId, columnId, title),
          "Unable to rename the column. The saved title was restored."
        )
      : Promise.resolve(false);

  const handleAddCard = (columnId: string, title: string, details: string) =>
    selectedBoardId
      ? runMutation(
          () => boardApi.createCard(selectedBoardId, columnId, title, details),
          "Unable to add the card. Please try again."
        )
      : Promise.resolve(false);

  const handleEditCard = (cardId: string, title: string, details: string) =>
    selectedBoardId
      ? runMutation(
          () => boardApi.editCard(selectedBoardId, cardId, title, details),
          "Unable to edit the card. The saved card was not changed."
        )
      : Promise.resolve(false);

  const handleDeleteCard = (cardId: string) =>
    selectedBoardId
      ? runMutation(
          () => boardApi.deleteCard(selectedBoardId, cardId),
          "Unable to remove the card. It remains on the saved board."
        )
      : Promise.resolve(false);

  const handleToggleLabel = (
    cardId: string,
    labelId: string,
    assign: boolean
  ) => {
    if (!selectedBoardId || !board) return Promise.resolve(false);
    const card = board.cards[cardId];
    if (!card) return Promise.resolve(false);
    const nextLabelIds = assign
      ? [...card.labelIds, labelId]
      : card.labelIds.filter((id) => id !== labelId);
    return runMutation(
      () => boardApi.setCardLabels(selectedBoardId, cardId, nextLabelIds),
      "Unable to update labels. Please try again."
    );
  };

  const handleCreateLabel = (name: string, color: string) =>
    selectedBoardId
      ? runMutation(
          () => boardApi.createLabel(selectedBoardId, name, color),
          "Unable to create the label. Please try again."
        )
      : Promise.resolve(false);

  const handleRenameLabel = (labelId: string, name: string, color: string) =>
    selectedBoardId
      ? runMutation(
          () => boardApi.renameLabel(selectedBoardId, labelId, name, color),
          "Unable to update the label. Please try again."
        )
      : Promise.resolve(false);

  const handleDeleteLabel = (labelId: string) =>
    selectedBoardId
      ? runMutation(
          () => boardApi.deleteLabel(selectedBoardId, labelId),
          "Unable to delete the label. Please try again."
        )
      : Promise.resolve(false);

  const handleCreateBoard = async (name: string): Promise<boolean> => {
    if (mutationInFlight.current) return false;
    mutationInFlight.current = true;
    setIsMutating(true);
    setMutationError(null);
    try {
      const created = await boardsApi.create(name);
      setBoards((current) => [...current, created]);
      mutationInFlight.current = false;
      setIsMutating(false);
      await switchBoard(created.id);
      return true;
    } catch (error) {
      mutationInFlight.current = false;
      setIsMutating(false);
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized();
        return false;
      }
      setMutationError("Unable to create the board. Please try again.");
      return false;
    }
  };

  const handleRenameBoard = async (
    boardId: number,
    name: string
  ): Promise<boolean> => {
    if (mutationInFlight.current) return false;
    mutationInFlight.current = true;
    setIsMutating(true);
    setMutationError(null);
    try {
      const renamed = await boardsApi.rename(boardId, name);
      setBoards((current) =>
        current.map((entry) => (entry.id === boardId ? renamed : entry))
      );
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized();
        return false;
      }
      setMutationError("Unable to rename the board. Please try again.");
      return false;
    } finally {
      mutationInFlight.current = false;
      setIsMutating(false);
    }
  };

  const handleDeleteBoard = async (boardId: number): Promise<boolean> => {
    if (mutationInFlight.current) return false;
    mutationInFlight.current = true;
    setIsMutating(true);
    setMutationError(null);
    try {
      const remaining = await boardsApi.delete(boardId);
      setBoards(remaining);
      mutationInFlight.current = false;
      setIsMutating(false);
      if (selectedBoardId === boardId && remaining.length > 0) {
        await switchBoard(remaining[0].id);
      }
      return true;
    } catch (error) {
      mutationInFlight.current = false;
      setIsMutating(false);
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized();
        return false;
      }
      setMutationError(
        error instanceof ApiError && error.status === 400
          ? "You cannot delete your only board."
          : "Unable to delete the board. Please try again."
      );
      return false;
    }
  };

  const handleSendChat = async (message: string): Promise<boolean> => {
    if (mutationInFlight.current || !selectedBoardId) return false;

    mutationInFlight.current = true;
    setIsMutating(true);
    setIsChatSending(true);
    setChatError(null);
    try {
      const response = await chatApi.send(
        selectedBoardId,
        message,
        getBoundedChatHistory(chatMessages)
      );
      if (response.boardChanged && !response.board) {
        throw new Error("Chat response omitted the updated board");
      }
      if (response.boardChanged && response.board) {
        setBoard(response.board);
      }
      setChatMessages((current) => [
        ...current,
        { role: "user", content: message },
        { role: "assistant", content: response.reply },
      ]);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized();
        return false;
      }
      setChatError(
        error instanceof ApiError && error.status === 503
          ? "The AI assistant is not configured. Check the OpenAI settings."
          : "The AI assistant could not complete that request. Please try again."
      );
      return false;
    } finally {
      mutationInFlight.current = false;
      setIsMutating(false);
      setIsChatSending(false);
    }
  };

  const focusColumnTitle = (columnId: string) => {
    const input = document.getElementById(`column-title-${columnId}`);
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  };

  if (isLoading) {
    return (
      <main className="auth-page flex min-h-screen items-center justify-center px-6">
        <div role="status" className="text-center">
          <div className="mx-auto h-10 w-10 animate-pulse rounded-full bg-[var(--primary-blue)]" />
          <p className="mt-4 text-sm font-semibold text-[var(--navy-dark)]">
            Loading your board...
          </p>
        </div>
      </main>
    );
  }

  if (!board || !selectedBoardId || loadError) {
    return (
      <main className="auth-page flex min-h-screen items-center justify-center px-6">
        <section className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-[var(--shadow-strong)]">
          <h1 className="font-display text-2xl font-semibold text-[var(--navy-dark)]">
            Unable to load board
          </h1>
          <p role="alert" className="mt-3 text-sm text-[var(--gray-text)]">
            {loadError}
          </p>
          <button
            type="button"
            onClick={retryLoadWorkspace}
            className="mt-6 rounded-full bg-[var(--secondary-purple)] px-5 py-2.5 text-sm font-semibold text-white"
          >
            Try again
          </button>
        </section>
      </main>
    );
  }

  const activeCard = activeCardId ? cardsById[activeCardId] : null;

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[460px] w-[460px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.28)_0%,_rgba(32,157,215,0.05)_58%,_transparent_72%)]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[560px] w-[560px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(139,92,246,0.2)_0%,_rgba(117,57,145,0.04)_58%,_transparent_75%)]" />

      <main className="relative mx-auto flex min-h-screen max-w-[1900px] flex-col gap-10 px-6 pb-16 pt-12">
        <header className="board-hero relative flex flex-col gap-6 overflow-hidden rounded-[28px] p-7 text-white shadow-[var(--shadow-strong)] md:p-8">
          <div className="tech-grid pointer-events-none absolute inset-0 opacity-40" />

          <div className="relative flex flex-wrap items-center justify-between gap-5">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-white/65">
                Project Boards
              </p>
              <h1 className="mt-2 font-display text-3xl font-semibold text-white md:text-4xl">
                Kanban Studio
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {username && onLogout ? (
                <div className="flex items-center gap-4 rounded-2xl border border-white/15 bg-white/10 px-4 py-2.5 backdrop-blur-sm">
                  <p className="text-sm text-white/70">
                    Signed in as <strong className="text-white">{username}</strong>
                  </p>
                  <button
                    type="button"
                    onClick={onLogout}
                    disabled={isLoggingOut || isMutating}
                    className="rounded-full border border-white/25 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-60"
                  >
                    {isLoggingOut ? "Logging out..." : "Log out"}
                  </button>
                </div>
              ) : null}
              {!isChatOpen ? (
                <button
                  type="button"
                  onClick={() => setChatVisibility(true)}
                  className="rounded-2xl bg-white px-5 py-2.5 text-sm font-semibold text-[var(--secondary-purple)] shadow-[0_12px_24px_rgba(3,33,71,0.18)] transition hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-white/30"
                >
                  Open AI Assistant
                </button>
              ) : null}
            </div>
          </div>

          <div className="relative">
            <BoardSwitcher
              boards={boards}
              selectedBoardId={selectedBoardId}
              isDisabled={isMutating}
              onSwitch={(boardId) => void switchBoard(boardId)}
              onCreate={handleCreateBoard}
              onRename={handleRenameBoard}
              onDelete={handleDeleteBoard}
            />
          </div>

          {authError ? (
            <p role="alert" className="relative text-sm font-medium text-[#ffd6d1]">
              {authError}
            </p>
          ) : null}

          <div className="relative">
            <p className="mb-3 text-xs font-medium text-white/65">
              Select a column below to rename it
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {board.columns.map((column, index) => (
                <button
                  key={column.id}
                  type="button"
                  onClick={() => focusColumnTitle(column.id)}
                  disabled={isMutating}
                  aria-label={`Rename ${column.title} column`}
                  className="column-chip flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white disabled:opacity-60"
                  style={{
                    "--column-accent": columnAccents[index],
                  } as CSSProperties}
                >
                  <span className="h-2.5 w-2.5 rounded-full bg-[var(--column-accent)] shadow-[0_0_12px_var(--column-accent)]" />
                  {column.title}
                </button>
              ))}
            </div>
          </div>
        </header>

        {mutationError ? (
          <p
            role="alert"
            className="rounded-2xl border border-[rgba(242,107,91,0.24)] bg-white px-5 py-4 text-sm font-medium text-[#b93f32] shadow-[var(--shadow)]"
          >
            {mutationError}
          </p>
        ) : null}

        <LabelManager
          labels={labels}
          isDisabled={isMutating}
          onCreate={handleCreateLabel}
          onRename={handleRenameLabel}
          onDelete={handleDeleteLabel}
        />

        <div className="flex min-w-0 items-start gap-6">
          <div className="min-w-0 flex-1 pb-3">
            <DndContext
              id="kanban-board-dnd"
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-5">
                {board.columns.map((column, index) => (
                  <KanbanColumn
                    key={`${column.id}:${column.title}`}
                    column={column}
                    accent={columnAccents[index]}
                    cards={column.cardIds.map((cardId) => board.cards[cardId])}
                    labels={labels}
                    isMutating={isMutating}
                    onRename={handleRenameColumn}
                    onAddCard={handleAddCard}
                    onEditCard={handleEditCard}
                    onDeleteCard={handleDeleteCard}
                    onToggleLabel={handleToggleLabel}
                  />
                ))}
              </section>
              <DragOverlay>
                {activeCard ? (
                  <div style={{ width: activeCardWidth ?? 260 }}>
                    <KanbanCardPreview card={activeCard} labels={labels} />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>

          {isChatOpen ? (
            <ChatSidebar
              messages={chatMessages}
              isSending={isChatSending}
              isBoardBusy={isMutating && !isChatSending}
              error={chatError}
              onClose={() => setChatVisibility(false)}
              onSend={handleSendChat}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
};
