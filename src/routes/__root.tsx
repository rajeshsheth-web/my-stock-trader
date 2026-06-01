import {
  HeadContent,
  Scripts,
  createRootRoute,
  Link,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { createContext, useContext, useEffect, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import appCss from "@/styles.css?url";

// ─── Auth context ─────────────────────────────────────────────────────────────

interface AuthContextValue {
  session: Session | null;
  supabase: SupabaseClient;
}

const AuthContext = createContext<AuthContextValue>({ session: null, supabase });

export function useAuth() {
  return useContext(AuthContext);
}

// ─── Root route ───────────────────────────────────────────────────────────────

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "MyStockTrader" },
      { name: "description", content: "AI-assisted equity research and paper-portfolio app" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
});

const NAV_LINKS = [
  { to: "/", label: "Movers" },
  { to: "/chart", label: "Chart" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/chat", label: "Chat" },
] as const;

function RootDocument({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <AuthContext.Provider value={{ session, supabase }}>
          <div className="min-h-dvh flex flex-col">
            <Header session={session} />
            <main className="flex-1 container mx-auto px-4 py-6 max-w-7xl">
              {children}
            </main>
          </div>
        </AuthContext.Provider>
        <Scripts />
      </body>
    </html>
  );
}

function Header({ session }: { session: Session | null }) {
  const state = useRouterState();
  const path = state.location.pathname;

  return (
    <header
      className="sticky top-0 z-50 border-b"
      style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
    >
      <div className="container mx-auto px-4 max-w-7xl flex items-center justify-between h-14">
        <Link to="/" className="font-bold text-lg" style={{ color: "var(--color-primary)" }}>
          MyStockTrader
        </Link>

        <nav className="hidden sm:flex items-center gap-1">
          {NAV_LINKS.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className="nav-link"
              aria-current={path === to ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {session ? (
            <button className="btn-ghost text-sm" onClick={() => supabase.auth.signOut()}>
              Sign out
            </button>
          ) : (
            <Link to="/auth" className="btn-primary text-sm">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
