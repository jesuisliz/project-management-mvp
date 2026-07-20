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
import { ChatSidebar } from "@/components/ChatSidebar";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import {
  ApiError,
  boardApi,
  chatApi,
} from "@/lib/api";
import { getBoundedChatHistory, type ChatMessage } from "@/lib/chat";
import {
  getCardDestination,
  type BoardData,
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
  const [board, setBoard] = useState<BoardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [chatVisibility, setChatVisibility] = useState<boolean | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isChatSending, setIsChatSending] = useState(false);
  const mutationInFlight = useRef(false);
  const isDesktopLayout = useSyncExternalStore(
    subscribeToDesktopLayout,
    getDesktopLayout,
    () => true
  );
  const isChatOpen = chatVisibility ?? isDesktopLayout;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const loadBoard = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setBoard(await boardApi.get());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized();
        return;
      }
      setLoadError("Unable to load your board. Check the server and try again.");
    } finally {
      setIsLoading(false);
    }
  }, [onUnauthorized]);

  useEffect(() => {
    let isActive = true;
    boardApi
      .get()
      .then((loadedBoard) => {
        if (isActive) setBoard(loadedBoard);
      })
      .catch((error: unknown) => {
        if (!isActive) return;
        if (error instanceof ApiError && error.status === 401) {
          onUnauthorized();
          return;
        }
        setLoadError("Unable to load your board. Check the server and try again.");
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [onUnauthorized]);

  const cardsById = useMemo(() => board?.cards ?? {}, [board]);

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
    if (!isMutating) setActiveCardId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);

    if (!board || !over || active.id === over.id || isMutating) {
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
          active.id as string,
          destination.columnId,
          destination.position
        ),
      "Unable to move the card. The saved board was not changed."
    );
  };

  const handleRenameColumn = (columnId: string, title: string) =>
    runMutation(
      () => boardApi.renameColumn(columnId, title),
      "Unable to rename the column. The saved title was restored."
    );

  const handleAddCard = (columnId: string, title: string, details: string) =>
    runMutation(
      () => boardApi.createCard(columnId, title, details),
      "Unable to add the card. Please try again."
    );

  const handleEditCard = (cardId: string, title: string, details: string) =>
    runMutation(
      () => boardApi.editCard(cardId, title, details),
      "Unable to edit the card. The saved card was not changed."
    );

  const handleDeleteCard = (cardId: string) =>
    runMutation(
      () => boardApi.deleteCard(cardId),
      "Unable to remove the card. It remains on the saved board."
    );

  const handleSendChat = async (message: string): Promise<boolean> => {
    if (mutationInFlight.current) return false;

    mutationInFlight.current = true;
    setIsMutating(true);
    setIsChatSending(true);
    setChatError(null);
    try {
      const response = await chatApi.send(
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

  if (!board || loadError) {
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
            onClick={() => void loadBoard()}
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
        <header className="board-hero flex flex-col gap-7 overflow-hidden rounded-[32px] p-8 text-white shadow-[var(--shadow-strong)]">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-white/65">
                Single Board Kanban
              </p>
              <h1 className="mt-3 font-display text-4xl font-semibold text-white">
                Kanban Studio
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-white/70">
                Keep momentum visible. Rename columns, drag cards between stages,
                and capture quick notes without getting buried in settings.
              </p>
            </div>
            <div className="flex min-w-[280px] flex-col gap-4">
              {username && onLogout ? (
                <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/15 bg-white/10 px-5 py-3 backdrop-blur-sm">
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
              <div className="rounded-2xl border border-white/15 bg-white/10 px-5 py-4 backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/55">
                  Focus
                </p>
                <p className="mt-2 text-lg font-semibold text-white">
                  One board. Five columns. Zero clutter.
                </p>
              </div>
              {!isChatOpen ? (
                <button
                  type="button"
                  onClick={() => setChatVisibility(true)}
                  className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-[var(--secondary-purple)] shadow-[0_12px_24px_rgba(3,33,71,0.18)] transition hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-white/30"
                >
                  Open AI Assistant
                </button>
              ) : null}
              {authError ? (
                <p role="alert" className="text-sm font-medium text-[#ffd6d1]">
                  {authError}
                </p>
              ) : null}
            </div>
          </div>
          <div>
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

        <div className="flex min-w-0 items-start gap-6">
          <div className="min-w-0 flex-1 overflow-x-auto pb-3">
            <DndContext
              id="kanban-board-dnd"
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <section className="grid gap-6 lg:min-w-[1100px] lg:grid-cols-5">
                {board.columns.map((column, index) => (
                  <KanbanColumn
                    key={`${column.id}:${column.title}`}
                    column={column}
                    accent={columnAccents[index]}
                    cards={column.cardIds.map((cardId) => board.cards[cardId])}
                    isMutating={isMutating}
                    onRename={handleRenameColumn}
                    onAddCard={handleAddCard}
                    onEditCard={handleEditCard}
                    onDeleteCard={handleDeleteCard}
                  />
                ))}
              </section>
              <DragOverlay>
                {activeCard ? (
                  <div className="w-[260px]">
                    <KanbanCardPreview card={activeCard} />
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
