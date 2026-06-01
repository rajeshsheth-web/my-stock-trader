import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

type Mode = "signin" | "signup";

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (mode === "signin") {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        await navigate({ to: "/" });
      } else {
        const { error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        setMessage("Check your email to confirm your account.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleOAuth() {
    setError(null);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/` },
    });
    if (err) setError(err.message);
  }

  return (
    <div className="flex justify-center py-16 px-4">
      <div className="card w-full max-w-md space-y-6">
        {/* Title */}
        <div className="text-center">
          <h1 className="text-2xl font-bold" style={{ color: "var(--color-fg)" }}>
            {mode === "signin" ? "Welcome back" : "Create account"}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
            {mode === "signin"
              ? "Sign in to your MyStockTrader account"
              : "Start tracking your portfolio today"}
          </p>
        </div>

        {/* Google OAuth */}
        <button
          type="button"
          onClick={handleGoogleOAuth}
          className="w-full flex items-center justify-center gap-3 rounded-md border py-2 text-sm font-medium transition-colors hover:bg-[var(--color-surface)]"
          style={{ borderColor: "var(--color-border)", color: "var(--color-fg)" }}
        >
          {/* Google "G" logo (inline SVG to avoid external dep) */}
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M47.53 24.56c0-1.64-.15-3.22-.42-4.74H24v8.97h13.22c-.57 3.07-2.3 5.67-4.9 7.41v6.16h7.93c4.64-4.28 7.28-10.59 7.28-17.8z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.65 0 12.22-2.2 16.3-5.96l-7.94-6.16c-2.2 1.48-5.02 2.36-8.36 2.36-6.43 0-11.87-4.34-13.82-10.18H2.01v6.35C6.08 42.87 14.43 48 24 48z"
            />
            <path
              fill="#FBBC05"
              d="M10.18 28.06A14.96 14.96 0 0 1 9.3 24c0-1.41.24-2.78.88-4.06v-6.35H2.01A23.97 23.97 0 0 0 0 24c0 3.87.93 7.53 2.01 10.41l8.17-6.35z"
            />
            <path
              fill="#EA4335"
              d="M24 9.76c3.62 0 6.86 1.24 9.42 3.68l7.06-7.06C36.22 2.19 30.65 0 24 0 14.43 0 6.08 5.13 2.01 13.59l8.17 6.35C12.13 14.1 17.57 9.76 24 9.76z"
            />
          </svg>
          Continue with Google
        </button>

        {/* Divider */}
        <div className="relative">
          <div
            className="absolute inset-0 flex items-center"
            aria-hidden="true"
          >
            <div className="w-full border-t" style={{ borderColor: "var(--color-border)" }} />
          </div>
          <div className="relative flex justify-center text-sm">
            <span
              className="px-3"
              style={{ background: "var(--color-surface)", color: "var(--color-muted)" }}
            >
              or continue with email
            </span>
          </div>
        </div>

        {/* Email / password form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium mb-1"
              style={{ color: "var(--color-fg)" }}
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-bg)",
                color: "var(--color-fg)",
              }}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium mb-1"
              style={{ color: "var(--color-fg)" }}
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-bg)",
                color: "var(--color-fg)",
              }}
            />
          </div>

          {/* Error / success messages */}
          {error && (
            <p className="text-sm font-medium" style={{ color: "var(--color-bear)" }}>
              {error}
            </p>
          )}
          {message && (
            <p className="text-sm font-medium" style={{ color: "var(--color-bull)" }}>
              {message}
            </p>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        {/* Mode toggle */}
        <p className="text-center text-sm" style={{ color: "var(--color-muted)" }}>
          {mode === "signin" ? "Don't have an account?" : "Already have an account?"}{" "}
          <button
            type="button"
            className="font-medium underline underline-offset-2"
            style={{ color: "var(--color-primary)" }}
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setMessage(null);
            }}
          >
            {mode === "signin" ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
