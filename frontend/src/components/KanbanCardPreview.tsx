import type { Card, Label } from "@/lib/kanban";

type KanbanCardPreviewProps = {
  card: Card;
  labels: Label[];
};

export const KanbanCardPreview = ({ card, labels }: KanbanCardPreviewProps) => {
  const cardLabels = labels.filter((label) => card.labelIds.includes(label.id));

  return (
    <article className="rounded-xl border border-transparent bg-white px-4 py-4 shadow-[0_18px_32px_rgba(3,33,71,0.16)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          {cardLabels.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {cardLabels.map((label) => (
                <span
                  key={label.id}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                  style={{ backgroundColor: label.color }}
                >
                  {label.name}
                </span>
              ))}
            </div>
          ) : null}
          <h4 className="font-display text-base font-semibold text-[var(--navy-dark)]">
            {card.title}
          </h4>
          <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
            {card.details}
          </p>
        </div>
      </div>
    </article>
  );
};
