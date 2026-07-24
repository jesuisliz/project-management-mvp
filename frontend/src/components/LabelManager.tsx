import clsx from "clsx";
import { useState, type FormEvent } from "react";
import { MAX_LABEL_NAME_LENGTH, type Label } from "@/lib/kanban";

const PALETTE = ["#ecad0a", "#209dd7", "#753991", "#032147", "#16a085", "#f26b5b"];

type LabelManagerProps = {
  labels: Label[];
  isDisabled: boolean;
  onCreate: (name: string, color: string) => Promise<boolean>;
  onRename: (labelId: string, name: string, color: string) => Promise<boolean>;
  onDelete: (labelId: string) => Promise<boolean>;
};

const ColorSwatches = ({
  selected,
  onSelect,
  isDisabled,
}: {
  selected: string;
  onSelect: (color: string) => void;
  isDisabled: boolean;
}) => (
  <div className="flex items-center gap-1">
    {PALETTE.map((swatch) => (
      <button
        key={swatch}
        type="button"
        onClick={() => onSelect(swatch)}
        disabled={isDisabled}
        aria-label={`Use color ${swatch}`}
        aria-pressed={selected === swatch}
        className={clsx(
          "h-4 w-4 rounded-full ring-offset-1 transition",
          selected === swatch && "ring-2 ring-[var(--navy-dark)]"
        )}
        style={{ backgroundColor: swatch }}
      />
    ))}
  </div>
);

export const LabelManager = ({
  labels,
  isDisabled,
  onCreate,
  onRename,
  onDelete,
}: LabelManagerProps) => {
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(PALETTE[0]);

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (await onCreate(trimmed, color)) {
      setName("");
      setColor(PALETTE[0]);
      setIsAdding(false);
    }
  };

  const startEditing = (label: Label) => {
    setEditingId(label.id);
    setEditName(label.name);
    setEditColor(label.color);
  };

  const submitEdit = async (
    event: FormEvent<HTMLFormElement>,
    labelId: string
  ) => {
    event.preventDefault();
    const trimmed = editName.trim();
    if (!trimmed) return;
    if (await onRename(labelId, trimmed, editColor)) {
      setEditingId(null);
    }
  };

  return (
    <section
      aria-label="Board labels"
      className="rounded-2xl border border-[var(--stroke)] bg-white/70 px-4 py-3 shadow-[var(--shadow)]"
    >
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
        Labels
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {labels.map((label) =>
          editingId === label.id ? (
            <form
              key={label.id}
              onSubmit={(event) => submitEdit(event, label.id)}
              className="flex items-center gap-1.5 rounded-full border border-[var(--stroke)] bg-white px-2.5 py-1"
            >
              <input
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                maxLength={MAX_LABEL_NAME_LENGTH}
                autoFocus
                aria-label="Label name"
                className="w-24 text-xs font-medium text-[var(--navy-dark)] outline-none"
                disabled={isDisabled}
              />
              <ColorSwatches
                selected={editColor}
                onSelect={setEditColor}
                isDisabled={isDisabled}
              />
              <button
                type="submit"
                disabled={isDisabled}
                className="text-xs font-semibold text-[var(--primary-blue)]"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditingId(null)}
                className="text-xs font-semibold text-[var(--gray-text)]"
              >
                Cancel
              </button>
            </form>
          ) : (
            <span
              key={label.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--stroke)] bg-white px-3 py-1 text-xs font-semibold text-[var(--navy-dark)]"
            >
              <button
                type="button"
                onClick={() => startEditing(label)}
                disabled={isDisabled}
                className="flex items-center gap-1.5"
                aria-label={`Edit ${label.name} label`}
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                {label.name}
              </button>
              <button
                type="button"
                onClick={() => void onDelete(label.id)}
                disabled={isDisabled}
                aria-label={`Delete ${label.name} label`}
                className="text-[var(--gray-text)] hover:text-[#b93f32]"
              >
                &times;
              </button>
            </span>
          )
        )}

        {isAdding ? (
          <form
            onSubmit={submitCreate}
            className="flex items-center gap-1.5 rounded-full border border-dashed border-[var(--stroke)] px-2.5 py-1"
          >
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Label name"
              maxLength={MAX_LABEL_NAME_LENGTH}
              autoFocus
              aria-label="New label name"
              className="w-24 text-xs font-medium text-[var(--navy-dark)] outline-none placeholder:text-[var(--gray-text)]"
              disabled={isDisabled}
            />
            <ColorSwatches
              selected={color}
              onSelect={setColor}
              isDisabled={isDisabled}
            />
            <button
              type="submit"
              disabled={isDisabled}
              className="text-xs font-semibold text-[var(--primary-blue)]"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="text-xs font-semibold text-[var(--gray-text)]"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            disabled={isDisabled}
            className="rounded-full border border-dashed border-[var(--stroke)] px-3 py-1 text-xs font-semibold text-[var(--gray-text)] hover:text-[var(--navy-dark)]"
          >
            + Label
          </button>
        )}
      </div>
    </section>
  );
};
