"use client";

import { useMemo, useState, type CSSProperties } from "react";
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
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import { createId, initialData, moveCard, type BoardData } from "@/lib/kanban";

const columnAccents = [
  "#209dd7",
  "#8b5cf6",
  "#ecad0a",
  "#f26b5b",
  "#16a085",
];

type KanbanBoardProps = {
  username?: string;
  onLogout?: () => void;
  isLoggingOut?: boolean;
  authError?: string | null;
};

export const KanbanBoard = ({
  username,
  onLogout,
  isLoggingOut = false,
  authError,
}: KanbanBoardProps) => {
  const [board, setBoard] = useState<BoardData>(() => initialData);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const cardsById = useMemo(() => board.cards, [board.cards]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);

    if (!over || active.id === over.id) {
      return;
    }

    setBoard((prev) => ({
      ...prev,
      columns: moveCard(prev.columns, active.id as string, over.id as string),
    }));
  };

  const handleRenameColumn = (columnId: string, title: string) => {
    setBoard((prev) => ({
      ...prev,
      columns: prev.columns.map((column) =>
        column.id === columnId ? { ...column, title } : column
      ),
    }));
  };

  const focusColumnTitle = (columnId: string) => {
    const input = document.getElementById(`column-title-${columnId}`);
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  };

  const handleAddCard = (columnId: string, title: string, details: string) => {
    const id = createId("card");
    setBoard((prev) => ({
      ...prev,
      cards: {
        ...prev.cards,
        [id]: { id, title, details: details || "No details yet." },
      },
      columns: prev.columns.map((column) =>
        column.id === columnId
          ? { ...column, cardIds: [...column.cardIds, id] }
          : column
      ),
    }));
  };

  const handleDeleteCard = (columnId: string, cardId: string) => {
    setBoard((prev) => {
      return {
        ...prev,
        cards: Object.fromEntries(
          Object.entries(prev.cards).filter(([id]) => id !== cardId)
        ),
        columns: prev.columns.map((column) =>
          column.id === columnId
            ? {
                ...column,
                cardIds: column.cardIds.filter((id) => id !== cardId),
              }
            : column
        ),
      };
    });
  };

  const activeCard = activeCardId ? cardsById[activeCardId] : null;

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[460px] w-[460px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.28)_0%,_rgba(32,157,215,0.05)_58%,_transparent_72%)]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[560px] w-[560px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(139,92,246,0.2)_0%,_rgba(117,57,145,0.04)_58%,_transparent_75%)]" />

      <main className="relative mx-auto flex min-h-screen max-w-[1500px] flex-col gap-10 px-6 pb-16 pt-12">
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
                    disabled={isLoggingOut}
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
                  aria-label={`Rename ${column.title} column`}
                  className="column-chip flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white"
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

        <DndContext
          id="kanban-board-dnd"
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <section className="grid gap-6 lg:grid-cols-5">
            {board.columns.map((column, index) => (
              <KanbanColumn
                key={column.id}
                column={column}
                accent={columnAccents[index]}
                cards={column.cardIds.map((cardId) => board.cards[cardId])}
                onRename={handleRenameColumn}
                onAddCard={handleAddCard}
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
      </main>
    </div>
  );
};
