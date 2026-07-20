"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { ChatMessage } from "@/lib/chat";

type ChatSidebarProps = {
  messages: ChatMessage[];
  isSending: boolean;
  isBoardBusy: boolean;
  error: string | null;
  onClose: () => void;
  onSend: (message: string) => Promise<boolean>;
};

export const ChatSidebar = ({
  messages,
  isSending,
  isBoardBusy,
  error,
  onClose,
  onSend,
}: ChatSidebarProps) => {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const isDisabled = isSending || isBoardBusy;

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages, isSending]);

  const sendDraft = async () => {
    const message = draft.trim();
    if (!message || isDisabled) return;
    if (await onSend(message)) setDraft("");
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendDraft();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void sendDraft();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-[rgba(3,33,71,0.38)] min-[1600px]:static min-[1600px]:z-auto min-[1600px]:block min-[1600px]:w-[390px] min-[1600px]:shrink-0 min-[1600px]:bg-transparent">
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default min-[1600px]:hidden"
      />
      <aside
        aria-label="AI assistant"
        className="relative ml-auto flex h-full w-full max-w-[430px] flex-col border-l border-[var(--stroke)] bg-white shadow-[var(--shadow-strong)] min-[1600px]:sticky min-[1600px]:top-6 min-[1600px]:h-[calc(100vh-3rem)] min-[1600px]:max-w-none min-[1600px]:rounded-[28px] min-[1600px]:border"
      >
        <header className="flex items-center justify-between gap-4 border-b border-[var(--stroke)] px-5 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--primary-blue)]">
              Board copilot
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold text-[var(--navy-dark)]">
              AI Assistant
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI assistant"
            className="grid h-10 w-10 place-items-center rounded-full border border-[var(--stroke)] text-[var(--navy-dark)] transition hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[rgba(32,157,215,0.18)]"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div
          role="log"
          aria-live="polite"
          aria-label="AI conversation"
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5"
        >
          {messages.length === 0 ? (
            <section className="rounded-2xl border border-[rgba(32,157,215,0.18)] bg-[rgba(32,157,215,0.06)] p-5">
              <p className="font-display text-lg font-semibold text-[var(--navy-dark)]">
                What should we change?
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
                Ask about the board, or create, edit, move, and reorder cards.
                The five columns stay fixed.
              </p>
            </section>
          ) : null}

          {messages.map((message, index) => (
            <article
              key={`${message.role}-${index}`}
              className={
                message.role === "user"
                  ? "ml-8 rounded-2xl rounded-br-md bg-[var(--secondary-purple)] px-4 py-3 text-white"
                  : "mr-8 rounded-2xl rounded-bl-md border border-[var(--stroke)] bg-[var(--surface)] px-4 py-3 text-[var(--navy-dark)]"
              }
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-65">
                {message.role === "user" ? "You" : "Assistant"}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
                {message.content}
              </p>
            </article>
          ))}

          {isSending ? (
            <div role="status" className="mr-8 rounded-2xl rounded-bl-md border border-[var(--stroke)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--gray-text)]">
              Assistant is working...
            </div>
          ) : null}
          <div ref={messageEndRef} />
        </div>

        <form onSubmit={handleSubmit} className="border-t border-[var(--stroke)] p-5">
          {error ? (
            <p role="alert" className="mb-3 rounded-xl border border-[rgba(242,107,91,0.24)] bg-[rgba(242,107,91,0.08)] px-3 py-2 text-sm font-medium text-[#b93f32]">
              {error}
            </p>
          ) : null}
          <label htmlFor="ai-message" className="sr-only">
            Message AI assistant
          </label>
          <textarea
            ref={textareaRef}
            id="ai-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={2000}
            rows={3}
            placeholder="Ask the assistant about your board"
            disabled={isDisabled}
            className="w-full resize-none rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-4 py-3 text-sm leading-6 text-[var(--navy-dark)] outline-none transition placeholder:text-[var(--gray-text)] focus:border-[var(--primary-blue)] focus:bg-white focus:ring-3 focus:ring-[rgba(32,157,215,0.14)] disabled:cursor-wait disabled:opacity-65"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--gray-text)]">
              Enter to send. Shift+Enter for a new line.
            </p>
            <button
              type="submit"
              disabled={isDisabled || !draft.trim()}
              className="rounded-full bg-[var(--secondary-purple)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(117,57,145,0.2)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSending ? "Sending..." : "Send"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
};
