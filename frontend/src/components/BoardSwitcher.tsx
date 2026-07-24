import { useState, type FormEvent } from "react";
import { MAX_BOARD_NAME_LENGTH, type BoardSummary } from "@/lib/kanban";

type BoardSwitcherProps = {
  boards: BoardSummary[];
  selectedBoardId: number;
  isDisabled: boolean;
  onSwitch: (boardId: number) => void;
  onCreate: (name: string) => Promise<boolean>;
  onRename: (boardId: number, name: string) => Promise<boolean>;
  onDelete: (boardId: number) => Promise<boolean>;
};

export const BoardSwitcher = ({
  boards,
  selectedBoardId,
  isDisabled,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}: BoardSwitcherProps) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const selectedBoard = boards.find((board) => board.id === selectedBoardId);

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (await onCreate(trimmed)) {
      setNewName("");
      setIsCreating(false);
    }
  };

  const startRenaming = () => {
    setRenameValue(selectedBoard?.name ?? "");
    setIsRenaming(true);
  };

  const submitRename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    if (await onRename(selectedBoardId, trimmed)) {
      setIsRenaming(false);
    }
  };

  const handleDelete = () => {
    if (boards.length <= 1) return;
    if (window.confirm(`Delete "${selectedBoard?.name ?? "this board"}"? This cannot be undone.`)) {
      void onDelete(selectedBoardId);
    }
  };

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      <label htmlFor="board-switcher" className="sr-only">
        Select a board
      </label>
      <select
        id="board-switcher"
        value={selectedBoardId}
        onChange={(event) => onSwitch(Number(event.target.value))}
        disabled={isDisabled}
        className="rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-semibold text-white outline-none disabled:opacity-60"
      >
        {boards.map((board) => (
          <option key={board.id} value={board.id} className="text-[var(--navy-dark)]">
            {board.name}
          </option>
        ))}
      </select>

      {isRenaming ? (
        <form onSubmit={submitRename} className="flex items-center gap-1.5">
          <input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            maxLength={MAX_BOARD_NAME_LENGTH}
            autoFocus
            aria-label="Board name"
            className="w-40 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white outline-none"
            disabled={isDisabled}
          />
          <button
            type="submit"
            disabled={isDisabled}
            className="rounded-full border border-white/25 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setIsRenaming(false)}
            className="rounded-full border border-white/25 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={startRenaming}
          disabled={isDisabled}
          className="rounded-full border border-white/25 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
        >
          Rename board
        </button>
      )}

      {isCreating ? (
        <form onSubmit={submitCreate} className="flex items-center gap-1.5">
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="New board name"
            maxLength={MAX_BOARD_NAME_LENGTH}
            autoFocus
            aria-label="New board name"
            className="w-40 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white outline-none placeholder:text-white/50"
            disabled={isDisabled}
          />
          <button
            type="submit"
            disabled={isDisabled}
            className="rounded-full border border-white/25 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setIsCreating(false)}
            className="rounded-full border border-white/25 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          disabled={isDisabled}
          className="rounded-full border border-white/25 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
        >
          New board
        </button>
      )}

      <button
        type="button"
        onClick={handleDelete}
        disabled={isDisabled || boards.length <= 1}
        title={
          boards.length <= 1
            ? "You cannot delete your only board"
            : "Delete this board"
        }
        className="rounded-full border border-white/25 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
      >
        Delete board
      </button>
    </div>
  );
};
