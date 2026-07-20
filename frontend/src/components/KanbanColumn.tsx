import clsx from "clsx";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useRef, useState, type CSSProperties } from "react";
import { MAX_TITLE_LENGTH, type Card, type Column } from "@/lib/kanban";
import { KanbanCard } from "@/components/KanbanCard";
import { NewCardForm } from "@/components/NewCardForm";

type KanbanColumnProps = {
  column: Column;
  accent: string;
  cards: Card[];
  isMutating: boolean;
  onRename: (columnId: string, title: string) => Promise<boolean>;
  onAddCard: (
    columnId: string,
    title: string,
    details: string
  ) => Promise<boolean>;
  onEditCard: (
    cardId: string,
    title: string,
    details: string
  ) => Promise<boolean>;
  onDeleteCard: (cardId: string) => Promise<boolean>;
};

export const KanbanColumn = ({
  column,
  accent,
  cards,
  isMutating,
  onRename,
  onAddCard,
  onEditCard,
  onDeleteCard,
}: KanbanColumnProps) => {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const [title, setTitle] = useState(column.title);
  const cancelRename = useRef(false);

  const saveTitle = async () => {
    if (cancelRename.current) {
      cancelRename.current = false;
      setTitle(column.title);
      return;
    }
    const trimmedTitle = title.trim();
    if (!trimmedTitle || trimmedTitle === column.title) {
      setTitle(column.title);
      return;
    }
    if (!(await onRename(column.id, trimmedTitle))) {
      setTitle(column.title);
    }
  };

  return (
    <section
      ref={setNodeRef}
      className={clsx(
        "column-shell flex min-h-[520px] flex-col rounded-3xl border p-4 shadow-[var(--shadow)] transition",
        isOver && "-translate-y-1 ring-2 ring-[var(--column-accent)]"
      )}
      style={{ "--column-accent": accent } as CSSProperties}
      data-testid={`column-${column.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="w-full">
          <div className="flex items-center gap-3">
            <div className="h-2 w-10 rounded-full bg-[var(--column-accent)] shadow-[0_0_14px_var(--column-accent)]" />
            <span className="rounded-full bg-white/75 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--gray-text)]">
              {cards.length} {cards.length === 1 ? "card" : "cards"}
            </span>
          </div>
          <label
            htmlFor={`column-title-${column.id}`}
            className="mt-4 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--gray-text)]"
          >
            <span>Column name</span>
            <span className="text-[var(--column-accent)]">Click to rename</span>
          </label>
          <input
            id={`column-title-${column.id}`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                cancelRename.current = true;
                event.currentTarget.blur();
              }
            }}
            disabled={isMutating}
            maxLength={MAX_TITLE_LENGTH}
            className="column-title-input mt-1.5 w-full rounded-xl border bg-white/80 px-3 py-2 font-display text-lg font-semibold text-[var(--navy-dark)] outline-none"
            aria-label="Column title"
            title="Click to rename this column"
          />
        </div>
      </div>
      <div className="mt-4 flex flex-1 flex-col gap-3">
        <SortableContext items={column.cardIds} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <KanbanCard
              key={card.id}
              card={card}
              isDisabled={isMutating}
              onEdit={onEditCard}
              onDelete={onDeleteCard}
            />
          ))}
        </SortableContext>
        {cards.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-[var(--stroke)] px-3 py-6 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
            Drop a card here
          </div>
        )}
      </div>
      <NewCardForm
        onAdd={(title, details) => onAddCard(column.id, title, details)}
        isDisabled={isMutating}
      />
    </section>
  );
};
