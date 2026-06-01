import {
  createRootRouteWithContext,
  Link,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { createContext, useContext, useEffect, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import "@/styles.css";

// ─── Auth context ─────────────────────────────────────────────────────────────

interface AuthContextValue {
  session: Session | null;
  supabase: SupabaseClient;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  supabase,
});

export function useAuth() {
  return useContext(AuthContext);
}

// ─── Root route ───────────────────────────────────────────────────────────────

interface RouterContext {
  supabase?: SupabaseClient;
  session?: Session | null;
}

export const RootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

// ─── Nav links ────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { to: "/", label: "Home" },
  { to: "/movers", label: "Movers" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/chat", label: "Chat" },
] as const;

// ─── Root component ───────────────────────────────────────────────────────────

function RootComponent() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ session, supabase }}>
      <div className="min-h-dvh flex flex-col">
        <Header session={session} />
        <main className="flex-1 container mx-auto px-4 py-6 max-w-7xl">
          <Outlet />
        </main>
      </div>
    </AuthContext.Provider>
  );
}

// ─── Header / nav ─────────────────────────────────────────────────────────────

function Header({ session }: { session: Session | null }) {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  return (
    <header
      className="sticky top-0 z-50 border-b"
      style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
    >
      <div className="container mx-auto px-4 max-w-7xl flex items-center justify-between h-14">
        {/* Logo */}
        <Link to="/" className="font-bold text-lg" style={{ color: "var(--color-primary)" }}>
          MyStockTrader
        </Link>

        {/* Primary nav */}
        <nav className="hidden sm:flex items-center gap-1">
          {NAV_LINKS.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className="nav-link"
              aria-current={currentPath === to ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* Auth actions */}
        <div className="flex items-center gap-2">
          {session ? (
            <button className="btn-ghost text-sm" onClick={handleSignOut}>
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
