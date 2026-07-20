import { useState, type FormEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import { MAX_DETAILS_LENGTH, MAX_TITLE_LENGTH, type Card } from "@/lib/kanban";

type KanbanCardProps = {
  card: Card;
  isDisabled: boolean;
  onEdit: (cardId: string, title: string, details: string) => Promise<boolean>;
  onDelete: (cardId: string) => Promise<boolean>;
};

export const KanbanCard = ({
  card,
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
      style={style}
      className={clsx(
        "card-surface rounded-2xl border bg-white px-4 py-4 shadow-[0_10px_24px_rgba(3,33,71,0.08)]",
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
          <div>
            <h4 className="font-display text-base font-semibold text-[var(--navy-dark)]">
              {card.title}
            </h4>
            <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
              {card.details || "No details yet."}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <button
              ref={setActivatorNodeRef}
              type="button"
              disabled={isDisabled}
              className="cursor-grab rounded-full border border-transparent p-1.5 text-[var(--gray-text)] hover:border-[var(--stroke)] disabled:cursor-wait disabled:opacity-60"
              aria-label={`Drag ${card.title}`}
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
            <button
              type="button"
              onClick={() => {
                setTitle(card.title);
                setDetails(card.details);
                setIsEditing(true);
              }}
              disabled={isDisabled}
              className="rounded-full border border-transparent px-2 py-1 text-xs font-semibold text-[var(--primary-blue)] transition hover:border-[var(--stroke)] disabled:opacity-60"
              aria-label={`Edit ${card.title}`}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => void onDelete(card.id)}
              disabled={isDisabled}
              className="rounded-full border border-transparent px-2 py-1 text-xs font-semibold text-[var(--gray-text)] transition hover:border-[var(--stroke)] hover:text-[var(--navy-dark)] disabled:opacity-60"
              aria-label={`Delete ${card.title}`}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </article>
  );
};
