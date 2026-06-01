import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useAuth } from "./__root";
import { useState, useEffect, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PortfolioRow {
  id: string;
  user_id: string;
  bucket: "short" | "long";
  symbols: string[];
}

const SYMBOL_RE = /^[A-Z0-9.\-^]{1,12}$/;

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/portfolio")({
  beforeLoad: async ({ context }) => {
    if (!context.session) {
      throw redirect({ to: "/auth" });
    }
  },
  component: PortfolioPage,
});

// ─── Bucket section ───────────────────────────────────────────────────────────

function BucketSection({
  title,
  bucket,
  row,
  userId,
  onChanged,
}: {
  title: string;
  bucket: "short" | "long";
  row: PortfolioRow | null;
  userId: string;
  onChanged: () => void;
}) {
  const { supabase } = useAuth();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const symbols: string[] = row?.symbols ?? [];

  async function addSymbol(e: React.FormEvent) {
    e.preventDefault();
    const sym = input.trim().toUpperCase();
    if (!sym) return;
    if (!SYMBOL_RE.test(sym)) {
      setError("Invalid symbol format");
      return;
    }
    if (symbols.includes(sym)) {
      setError("Already in list");
      return;
    }
    setError("");
    setBusy(true);
    try {
      if (row) {
        await supabase
          .from("portfolios")
          .update({ symbols: [...symbols, sym] })
          .eq("id", row.id);
      } else {
        await supabase.from("portfolios").insert({
          user_id: userId,
          bucket,
          symbols: [sym],
        });
      }
      setInput("");
      onChanged();
    } catch {
      setError("Failed to add symbol");
    } finally {
      setBusy(false);
    }
  }

  async function removeSymbol(sym: string) {
    if (!row) return;
    const next = symbols.filter((s) => s !== sym);
    await supabase
      .from("portfolios")
      .update({ symbols: next })
      .eq("id", row.id);
    onChanged();
  }

  return (
    <div className="card space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-base" style={{ color: "var(--color-fg)" }}>
          {title}
        </h2>
        <span
          className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{
            background: bucket === "short" ? "rgba(235,15,41,0.1)" : "rgba(0,135,60,0.1)",
            color: bucket === "short" ? "var(--color-bear)" : "var(--color-bull)",
          }}
        >
          {symbols.length} symbol{symbols.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Symbol list */}
      {symbols.length === 0 ? (
        <div className="py-8 text-center rounded-lg border border-dashed" style={{ borderColor: "var(--color-border)" }}>
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            No symbols yet. Add one below.
          </p>
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
          {symbols.map((sym) => (
            <div
              key={sym}
              className="flex items-center justify-between py-2.5"
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={() => navigate({ to: "/", search: { symbol: sym, tab: "Summary" } })}
                  className="font-mono font-semibold text-sm hover:underline"
                  style={{ color: "var(--color-primary)" }}
                >
                  {sym}
                </button>
                <span className="text-sm tabular-nums" style={{ color: "var(--color-muted)" }}>—</span>
              </div>
              <button
                onClick={() => removeSymbol(sym)}
                className="btn-ghost text-xs px-2 py-1"
                style={{ color: "var(--color-bear)" }}
                aria-label={`Remove ${sym}`}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add ticker input */}
      <form onSubmit={addSymbol} className="flex items-center gap-2 pt-1">
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value.toUpperCase());
            setError("");
          }}
          placeholder="Add ticker…"
          maxLength={12}
          className="flex-1 rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          style={{
            borderColor: error ? "var(--color-bear)" : "var(--color-border)",
            background: "var(--color-bg)",
            color: "var(--color-fg)",
          }}
        />
        <button type="submit" disabled={busy} className="btn-primary text-sm py-1.5">
          {busy ? "Adding…" : "Add"}
        </button>
      </form>
      {error && (
        <p className="text-xs mt-0" style={{ color: "var(--color-bear)" }}>{error}</p>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function PortfolioPage() {
  const { session, supabase } = useAuth();
  const userId = session!.user.id;

  const [rows, setRows] = useState<PortfolioRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPortfolio = useCallback(async () => {
    const { data } = await supabase
      .from("portfolios")
      .select("*")
      .eq("user_id", userId);
    setRows((data as PortfolioRow[]) ?? []);
    setLoading(false);
  }, [supabase, userId]);

  useEffect(() => {
    fetchPortfolio();
  }, [fetchPortfolio]);

  const shortRow = rows.find((r) => r.bucket === "short") ?? null;
  const longRow = rows.find((r) => r.bucket === "long") ?? null;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--color-fg)" }}>
          Watchlists
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Track symbols in your short-term and long-term buckets. Click any ticker to view its detail page.
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className="card animate-pulse space-y-3">
              <div className="h-4 rounded bg-[var(--color-border)] w-32" />
              <div className="h-10 rounded bg-[var(--color-border)]" />
              <div className="h-8 rounded bg-[var(--color-border)] w-48" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <BucketSection
            title="Short-term"
            bucket="short"
            row={shortRow}
            userId={userId}
            onChanged={fetchPortfolio}
          />
          <BucketSection
            title="Long-term"
            bucket="long"
            row={longRow}
            userId={userId}
            onChanged={fetchPortfolio}
          />
        </div>
      )}
    </div>
  );
}
