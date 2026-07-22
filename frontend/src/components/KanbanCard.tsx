import { useState, type CSSProperties, type FormEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import { MAX_DETAILS_LENGTH, MAX_TITLE_LENGTH, type Card } from "@/lib/kanban";

type KanbanCardProps = {
  card: Card;
  accent: string;
  isDisabled: boolean;
  onEdit: (cardId: string, title: string, details: string) => Promise<boolean>;
  onDelete: (cardId: string) => Promise<boolean>;
};

export const KanbanCard = ({
  card,
  accent,
  isDisabled,
  onEdit,
  onDelete,
}: KanbanCardProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [details, setDetails] = useState(card.details);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, disabled: isDisabled || isEditing });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const cancelEdit = () => {
    setTitle(card.title);
    setDetails(card.details);
    setIsEditing(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    if (await onEdit(card.id, trimmedTitle, details.trim())) {
      setIsEditing(false);
    }
  };

  return (
    <article
      ref={setNodeRef}
      style={{ ...style, "--column-accent": accent } as CSSProperties}
      className={clsx(
        "card-surface rounded-xl border bg-white px-4 py-4 shadow-[0_10px_24px_rgba(3,33,71,0.08)]",
        "transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_16px_30px_rgba(3,33,71,0.13)]",
        isDragging && "opacity-60 shadow-[0_18px_32px_rgba(3,33,71,0.16)]"
      )}
      data-testid={`card-${card.id}`}
    >
      {isEditing ? (
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block text-xs font-semibold text-[var(--gray-text)]">
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={isDisabled}
              maxLength={MAX_TITLE_LENGTH}
              className="mt-1 w-full rounded-xl border border-[var(--stroke)] px-3 py-2 text-sm text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]"
            />
          </label>
          <label className="block text-xs font-semibold text-[var(--gray-text)]">
            Details
            <textarea
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              disabled={isDisabled}
              rows={3}
              maxLength={MAX_DETAILS_LENGTH}
              className="mt-1 w-full resize-none rounded-xl border border-[var(--stroke)] px-3 py-2 text-sm text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isDisabled || !title.trim()}
              className="rounded-full bg-[var(--secondary-purple)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              Save
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={isDisabled}
              className="rounded-full border border-[var(--stroke)] px-3 py-1.5 text-xs font-semibold text-[var(--gray-text)]"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h4 className="font-display text-base font-semibold text-[var(--navy-dark)]">
              {card.title}
            </h4>
            <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
              {card.details || "No details yet."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => {
                setTitle(card.title);
                setDetails(card.details);
                setIsEditing(true);
              }}
              disabled={isDisabled}
              className="icon-btn icon-btn--edit"
              aria-label={`Edit ${card.title}`}
              title="Edit card"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => void onDelete(card.id)}
              disabled={isDisabled}
              className="icon-btn icon-btn--delete"
              aria-label={`Delete ${card.title}`}
              title="Delete card"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </button>
            <button
              ref={setActivatorNodeRef}
              type="button"
              disabled={isDisabled}
              className="icon-btn cursor-grab"
              aria-label={`Drag ${card.title}`}
              title="Drag to move"
              {...attributes}
              {...listeners}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 12 18"
                className="h-[18px] w-3"
                fill="currentColor"
              >
                <circle cx="3" cy="3" r="1.5" />
                <circle cx="9" cy="3" r="1.5" />
                <circle cx="3" cy="9" r="1.5" />
                <circle cx="9" cy="9" r="1.5" />
                <circle cx="3" cy="15" r="1.5" />
                <circle cx="9" cy="15" r="1.5" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </article>
  );
};
