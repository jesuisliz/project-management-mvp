"use client";

import { useEffect, useState, type FormEvent } from "react";
import { KanbanBoard } from "@/components/KanbanBoard";

type SessionPayload = {
  authenticated: boolean;
  username: string | null;
};

type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; username: string };

type LoginFormProps = {
  onSignedIn: (username: string) => void;
};

const LoginForm = ({ onSignedIn }: LoginFormProps) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username: username.trim(), password }),
      });

      if (response.status === 401) {
        setError("Invalid username or password.");
        return;
      }
      if (!response.ok) {
        throw new Error("Login request failed");
      }

      const session = (await response.json()) as SessionPayload;
      if (!session.authenticated || !session.username) {
        throw new Error("Login response was not authenticated");
      }
      onSignedIn(session.username);
    } catch {
      setError("Unable to sign in. Check that the server is running.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-page relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-12">
      <div className="pointer-events-none absolute left-[8%] top-[12%] h-64 w-64 rounded-full bg-[var(--primary-blue)]/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[8%] right-[8%] h-72 w-72 rounded-full bg-[var(--accent-violet)]/20 blur-3xl" />
      <section className="relative grid w-full max-w-5xl overflow-hidden rounded-[32px] bg-white shadow-[var(--shadow-strong)] md:grid-cols-[1.05fr_0.95fr]">
        <div className="board-hero flex flex-col justify-between gap-12 p-8 text-white md:p-12">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-white/65">
              Project Management MVP
            </p>
            <h1 className="mt-5 font-display text-4xl font-semibold leading-tight md:text-5xl">
              Make the next move visible.
            </h1>
            <p className="mt-5 max-w-md text-sm leading-7 text-white/70">
              Sign in to organize work across one focused Kanban board.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.14em]">
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-2">
              Plan
            </span>
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-2">
              Move
            </span>
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-2">
              Deliver
            </span>
          </div>
        </div>

        <div className="flex flex-col justify-center p-8 md:p-12">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--primary-blue)]">
            Local workspace
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold text-[var(--navy-dark)]">
            Sign in
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
            Enter the MVP account credentials to open your board.
          </p>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit} noValidate>
            <div>
              <label
                htmlFor="username"
                className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--gray-text)]"
              >
                Username
              </label>
              <input
                id="username"
                name="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                className="mt-2 w-full rounded-xl border border-[var(--stroke)] bg-[var(--surface)] px-4 py-3 text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)] focus:bg-white focus:ring-3 focus:ring-[rgba(32,157,215,0.14)]"
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--gray-text)]"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                className="mt-2 w-full rounded-xl border border-[var(--stroke)] bg-[var(--surface)] px-4 py-3 text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)] focus:bg-white focus:ring-3 focus:ring-[rgba(32,157,215,0.14)]"
              />
            </div>

            {error ? (
              <p
                role="alert"
                className="rounded-xl border border-[rgba(242,107,91,0.24)] bg-[rgba(242,107,91,0.08)] px-4 py-3 text-sm font-medium text-[#b93f32]"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-xl bg-[var(--secondary-purple)] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(117,57,145,0.24)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-65"
            >
              {isSubmitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
};

export const AuthApp = () => {
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    let isActive = true;

    const loadSession = async () => {
      try {
        const response = await fetch("/api/auth/session", {
          credentials: "same-origin",
        });
        if (response.status === 401) {
          if (isActive) setSession({ status: "anonymous" });
          return;
        }
        if (!response.ok) {
          throw new Error("Session request failed");
        }

        const current = (await response.json()) as SessionPayload;
        if (!isActive) return;
        setSession(
          current.authenticated && current.username
            ? { status: "authenticated", username: current.username }
            : { status: "anonymous" }
        );
      } catch {
        if (isActive) setSession({ status: "anonymous" });
      }
    };

    void loadSession();
    return () => {
      isActive = false;
    };
  }, []);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    setLogoutError(null);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      if (response.ok || response.status === 401) {
        setSession({ status: "anonymous" });
        return;
      }
      throw new Error("Logout request failed");
    } catch {
      setLogoutError("Unable to log out. Please try again.");
    } finally {
      setIsLoggingOut(false);
    }
  };

  if (session.status === "loading") {
    return (
      <main className="auth-page flex min-h-screen items-center justify-center px-6">
        <div role="status" className="text-center">
          <div className="mx-auto h-10 w-10 animate-pulse rounded-full bg-[var(--primary-blue)]" />
          <p className="mt-4 text-sm font-semibold text-[var(--navy-dark)]">
            Loading your workspace...
          </p>
        </div>
      </main>
    );
  }

  if (session.status === "anonymous") {
    return (
      <LoginForm
        onSignedIn={(username) =>
          setSession({ status: "authenticated", username })
        }
      />
    );
  }

  return (
    <KanbanBoard
      username={session.username}
      onLogout={handleLogout}
      isLoggingOut={isLoggingOut}
      authError={logoutError}
    />
  );
};
