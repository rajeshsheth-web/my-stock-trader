import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useAuth } from "./__root";
import { useState, useEffect, useCallback, useRef } from "react";
import { getStockQuote } from "@/server/stock";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PortfolioRow {
  id: string;
  user_id: string;
  bucket: "short" | "long";
  symbols: string[];
}

interface QuoteInfo {
  price: number;
  change: number;
  changePct: number;
  marketState: string;
}

interface PaperPosition {
  symbol: string;
  shares: number;
  avgCost: number;
}

interface PaperTrade {
  id: string;
  symbol: string;
  shares: number;
  price: number;
  side: "buy" | "sell";
  ts: number;
}

interface PaperState {
  cash: number;
  positions: PaperPosition[];
  trades: PaperTrade[];
}

const SYMBOL_RE = /^[A-Z0-9.\-^]{1,12}$/;
const PAPER_KEY = "paper_v1";
const INITIAL_CASH = 100_000;

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/portfolio")({
  beforeLoad: async ({ context }) => {
    if (!context.session) {
      throw redirect({ to: "/auth" });
    }
  },
  component: PortfolioPage,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPrice(n: number) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtDollar(n: number) {
  return (n < 0 ? "-$" : "$") + fmtPrice(Math.abs(n));
}

function fmtAbbrev(n: number) {
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + fmtPrice(n);
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function loadPaper(): PaperState {
  try {
    const raw = localStorage.getItem(PAPER_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { cash: INITIAL_CASH, positions: [], trades: [] };
}

function savePaper(state: PaperState) {
  localStorage.setItem(PAPER_KEY, JSON.stringify(state));
}

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
  const [quotes, setQuotes] = useState<Record<string, QuoteInfo>>({});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const symbols: string[] = row?.symbols ?? [];

  const fetchQuotes = useCallback(async () => {
    if (symbols.length === 0) return;
    try {
      const results = await Promise.all(
        symbols.map(sym => getStockQuote({ data: sym }).catch(() => null))
      );
      const map: Record<string, QuoteInfo> = {};
      symbols.forEach((sym, i) => {
        const q = results[i];
        if (q) map[sym] = { price: q.price, change: q.change, changePct: q.changePct, marketState: q.marketState };
      });
      setQuotes(map);
    } catch {}
  }, [symbols.join(",")]);

  useEffect(() => {
    fetchQuotes();
    intervalRef.current = setInterval(fetchQuotes, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchQuotes]);

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
          {symbols.map((sym) => {
            const q = quotes[sym];
            const isUp = q ? q.change >= 0 : true;
            const sign = isUp ? "+" : "";
            return (
              <div
                key={sym}
                className="flex items-center justify-between py-2.5"
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={() => navigate({ to: "/chart", search: { symbol: sym, tab: "Summary" } })}
                    className="font-mono font-semibold text-sm hover:underline"
                    style={{ color: "var(--color-primary)" }}
                  >
                    {sym}
                  </button>
                  {q ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--color-fg)" }}>
                        ${fmtPrice(q.price)}
                      </span>
                      <span
                        className="text-xs tabular-nums font-medium"
                        style={{ color: isUp ? "var(--color-bull)" : "var(--color-bear)" }}
                      >
                        {sign}{fmtPrice(q.change)} ({sign}{q.changePct.toFixed(2)}%)
                      </span>
                      {q.marketState !== "REGULAR" && (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded font-semibold"
                          style={{ background: "rgba(217,119,6,0.12)", color: "#d97706", border: "1px solid rgba(217,119,6,0.3)" }}
                        >
                          {q.marketState === "PRE" || q.marketState === "PREPRE" ? "Pre" : q.marketState === "POST" || q.marketState === "POSTPOST" ? "AH" : q.marketState}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="inline-block h-4 w-24 rounded animate-pulse bg-[var(--color-border)]" />
                  )}
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
            );
          })}
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

// ─── Paper Trading ────────────────────────────────────────────────────────────

function PaperTrading() {
  const [paper, setPaper] = useState<PaperState>(() => loadPaper());
  const [tradeSymbol, setTradeSymbol] = useState("");
  const [tradeShares, setTradeShares] = useState("");
  const [tradeError, setTradeError] = useState("");
  const [tradeBusy, setTradeBusy] = useState(false);
  const [positionPrices, setPositionPrices] = useState<Record<string, number>>({});
  const [confirmReset, setConfirmReset] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function persist(next: PaperState) {
    setPaper(next);
    savePaper(next);
  }

  const fetchPositionPrices = useCallback(async () => {
    const syms = paper.positions.map(p => p.symbol);
    if (syms.length === 0) return;
    try {
      const results = await Promise.all(
        syms.map(sym => getStockQuote({ data: sym }).catch(() => null))
      );
      const map: Record<string, number> = {};
      syms.forEach((sym, i) => {
        const q = results[i];
        if (q) map[sym] = q.price;
      });
      setPositionPrices(map);
    } catch {}
  }, [paper.positions.map(p => p.symbol).join(",")]);

  useEffect(() => {
    fetchPositionPrices();
    intervalRef.current = setInterval(fetchPositionPrices, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchPositionPrices]);

  async function executeTrade(side: "buy" | "sell") {
    const sym = tradeSymbol.trim().toUpperCase();
    const shares = parseFloat(tradeShares);
    if (!SYMBOL_RE.test(sym)) { setTradeError("Invalid symbol"); return; }
    if (!shares || shares <= 0 || !Number.isFinite(shares)) { setTradeError("Invalid shares"); return; }
    setTradeError("");
    setTradeBusy(true);
    try {
      const q = await getStockQuote({ data: sym });
      if (!q) { setTradeError("Could not fetch price"); return; }
      const price = q.price;
      const cost = price * shares;

      if (side === "buy") {
        if (cost > paper.cash) { setTradeError(`Insufficient cash (need $${fmtPrice(cost)})`); return; }
        const next = { ...paper };
        next.cash = paper.cash - cost;
        const existingIdx = next.positions.findIndex(p => p.symbol === sym);
        if (existingIdx >= 0) {
          const existing = next.positions[existingIdx];
          const totalShares = existing.shares + shares;
          const avgCost = (existing.shares * existing.avgCost + shares * price) / totalShares;
          next.positions = next.positions.map((p, i) => i === existingIdx ? { ...p, shares: totalShares, avgCost } : p);
        } else {
          next.positions = [...next.positions, { symbol: sym, shares, avgCost: price }];
        }
        next.trades = [
          { id: crypto.randomUUID(), symbol: sym, shares, price, side: "buy" as const, ts: Date.now() },
          ...next.trades,
        ].slice(0, 100);
        persist(next);
        setTradeSymbol("");
        setTradeShares("");
      } else {
        const existing = paper.positions.find(p => p.symbol === sym);
        if (!existing || existing.shares < shares) { setTradeError(`Insufficient shares (have ${existing?.shares ?? 0})`); return; }
        const next = { ...paper };
        next.cash = paper.cash + cost;
        const remaining = existing.shares - shares;
        next.positions = remaining > 0
          ? next.positions.map(p => p.symbol === sym ? { ...p, shares: remaining } : p)
          : next.positions.filter(p => p.symbol !== sym);
        next.trades = [
          { id: crypto.randomUUID(), symbol: sym, shares, price, side: "sell" as const, ts: Date.now() },
          ...next.trades,
        ].slice(0, 100);
        persist(next);
        setTradeSymbol("");
        setTradeShares("");
      }
    } catch {
      setTradeError("Trade failed");
    } finally {
      setTradeBusy(false);
    }
  }

  async function sellAll(sym: string) {
    const pos = paper.positions.find(p => p.symbol === sym);
    if (!pos) return;
    try {
      const q = await getStockQuote({ data: sym });
      if (!q) return;
      const price = q.price;
      const next = { ...paper };
      next.cash = paper.cash + price * pos.shares;
      next.positions = next.positions.filter(p => p.symbol !== sym);
      next.trades = [
        { id: crypto.randomUUID(), symbol: sym, shares: pos.shares, price, side: "sell" as const, ts: Date.now() },
        ...next.trades,
      ].slice(0, 100);
      persist(next);
    } catch {}
  }

  function doReset() {
    const fresh: PaperState = { cash: INITIAL_CASH, positions: [], trades: [] };
    persist(fresh);
    setPositionPrices({});
    setConfirmReset(false);
  }

  // Summary calculations
  const invested = paper.positions.reduce((sum, p) => {
    const cur = positionPrices[p.symbol] ?? p.avgCost;
    return sum + cur * p.shares;
  }, 0);
  const totalValue = paper.cash + invested;
  const totalPnl = totalValue - INITIAL_CASH;
  const pnlUp = totalPnl >= 0;

  const recentTrades = paper.trades.slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold" style={{ color: "var(--color-fg)" }}>Paper Trading</h2>
        <button
          onClick={() => setConfirmReset(true)}
          className="btn-ghost text-xs px-3 py-1.5"
          style={{ color: "var(--color-muted)" }}
        >
          Reset to $100K
        </button>
      </div>
      {confirmReset && (
        <div className="card border" style={{ borderColor: "var(--color-bear)" }}>
          <p className="text-sm mb-3" style={{ color: "var(--color-fg)" }}>Reset all paper trading data to $100,000? This cannot be undone.</p>
          <div className="flex gap-2">
            <button onClick={doReset} className="btn-primary text-sm" style={{ background: "var(--color-bear)" }}>Yes, Reset</button>
            <button onClick={() => setConfirmReset(false)} className="btn-ghost text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Summary bar */}
      <div className="card grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Cash", value: fmtDollar(paper.cash), color: "var(--color-fg)" },
          { label: "Invested", value: fmtDollar(invested), color: "var(--color-fg)" },
          { label: "Total Value", value: fmtDollar(totalValue), color: "var(--color-fg)" },
          {
            label: "Total P&L",
            value: (pnlUp ? "+" : "") + fmtDollar(totalPnl) + " (" + (pnlUp ? "+" : "") + ((totalPnl / INITIAL_CASH) * 100).toFixed(2) + "%)",
            color: pnlUp ? "var(--color-bull)" : "var(--color-bear)",
          },
        ].map(({ label, value, color }) => (
          <div key={label}>
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>{label}</p>
            <p className="text-sm font-bold tabular-nums mt-0.5" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Buy/Sell form */}
      <div className="card space-y-3">
        <h3 className="text-xs font-semibold uppercase" style={{ color: "var(--color-muted)" }}>Place Order</h3>
        <div className="flex gap-2 flex-wrap">
          <input
            value={tradeSymbol}
            onChange={e => { setTradeSymbol(e.target.value.toUpperCase()); setTradeError(""); }}
            placeholder="Symbol"
            maxLength={12}
            className="rounded-md border px-3 py-1.5 text-sm w-28 outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            style={{ borderColor: tradeError ? "var(--color-bear)" : "var(--color-border)", background: "var(--color-bg)", color: "var(--color-fg)" }}
          />
          <input
            value={tradeShares}
            onChange={e => { setTradeShares(e.target.value); setTradeError(""); }}
            placeholder="Shares"
            type="number"
            min="0.001"
            step="any"
            className="rounded-md border px-3 py-1.5 text-sm w-28 outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            style={{ borderColor: tradeError ? "var(--color-bear)" : "var(--color-border)", background: "var(--color-bg)", color: "var(--color-fg)" }}
          />
          <button
            onClick={() => executeTrade("buy")}
            disabled={tradeBusy}
            className="btn-primary text-sm py-1.5 px-4"
            style={{ background: "var(--color-bull)" }}
          >
            {tradeBusy ? "…" : "Buy"}
          </button>
          <button
            onClick={() => executeTrade("sell")}
            disabled={tradeBusy}
            className="btn-primary text-sm py-1.5 px-4"
            style={{ background: "var(--color-bear)" }}
          >
            {tradeBusy ? "…" : "Sell"}
          </button>
        </div>
        {tradeError && <p className="text-xs" style={{ color: "var(--color-bear)" }}>{tradeError}</p>}
      </div>

      {/* Positions table */}
      <div className="card">
        <h3 className="text-xs font-semibold uppercase mb-4" style={{ color: "var(--color-muted)" }}>Positions</h3>
        {paper.positions.length === 0 ? (
          <p className="text-sm py-4 text-center" style={{ color: "var(--color-muted)" }}>No open positions.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: "var(--color-border)" }}>
                  {["Symbol", "Shares", "Avg Cost", "Current", "P&L $", "P&L %", ""].map(h => (
                    <th key={h} className="text-left pb-2 pr-3 text-xs font-semibold" style={{ color: "var(--color-muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paper.positions.map(pos => {
                  const cur = positionPrices[pos.symbol];
                  const pnlD = cur != null ? (cur - pos.avgCost) * pos.shares : null;
                  const pnlP = cur != null ? ((cur - pos.avgCost) / pos.avgCost) * 100 : null;
                  const up = pnlD != null ? pnlD >= 0 : true;
                  const pnlColor = pnlD != null ? (up ? "var(--color-bull)" : "var(--color-bear)") : "var(--color-muted)";
                  return (
                    <tr key={pos.symbol} className="border-b last:border-0" style={{ borderColor: "var(--color-border)" }}>
                      <td className="py-2 pr-3 font-mono font-semibold" style={{ color: "var(--color-primary)" }}>{pos.symbol}</td>
                      <td className="py-2 pr-3 tabular-nums" style={{ color: "var(--color-fg)" }}>{pos.shares}</td>
                      <td className="py-2 pr-3 tabular-nums" style={{ color: "var(--color-fg)" }}>${fmtPrice(pos.avgCost)}</td>
                      <td className="py-2 pr-3 tabular-nums" style={{ color: "var(--color-fg)" }}>
                        {cur != null ? "$" + fmtPrice(cur) : <span className="inline-block h-4 w-16 rounded animate-pulse bg-[var(--color-border)]" />}
                      </td>
                      <td className="py-2 pr-3 tabular-nums font-medium" style={{ color: pnlColor }}>
                        {pnlD != null ? (pnlD >= 0 ? "+" : "") + fmtDollar(pnlD) : "—"}
                      </td>
                      <td className="py-2 pr-3 tabular-nums font-medium" style={{ color: pnlColor }}>
                        {pnlP != null ? (pnlP >= 0 ? "+" : "") + pnlP.toFixed(2) + "%" : "—"}
                      </td>
                      <td className="py-2">
                        <button
                          onClick={() => sellAll(pos.symbol)}
                          className="btn-ghost text-xs px-2 py-1"
                          style={{ color: "var(--color-bear)" }}
                        >
                          Sell All
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent trades */}
      <div className="card">
        <h3 className="text-xs font-semibold uppercase mb-4" style={{ color: "var(--color-muted)" }}>Recent Trades</h3>
        {recentTrades.length === 0 ? (
          <p className="text-sm py-4 text-center" style={{ color: "var(--color-muted)" }}>No trades yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: "var(--color-border)" }}>
                  {["Symbol", "Side", "Shares", "Price", "Time"].map(h => (
                    <th key={h} className="text-left pb-2 pr-4 text-xs font-semibold" style={{ color: "var(--color-muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentTrades.map(t => (
                  <tr key={t.id} className="border-b last:border-0" style={{ borderColor: "var(--color-border)" }}>
                    <td className="py-2 pr-4 font-mono font-semibold" style={{ color: "var(--color-primary)" }}>{t.symbol}</td>
                    <td className="py-2 pr-4">
                      <span
                        className="text-xs font-bold px-1.5 py-0.5 rounded"
                        style={{
                          background: t.side === "buy" ? "rgba(0,135,60,0.12)" : "rgba(235,15,41,0.1)",
                          color: t.side === "buy" ? "var(--color-bull)" : "var(--color-bear)",
                        }}
                      >
                        {t.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2 pr-4 tabular-nums" style={{ color: "var(--color-fg)" }}>{t.shares}</td>
                    <td className="py-2 pr-4 tabular-nums" style={{ color: "var(--color-fg)" }}>${fmtPrice(t.price)}</td>
                    <td className="py-2 tabular-nums text-xs" style={{ color: "var(--color-muted)" }}>{fmtTime(t.ts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
          Portfolio
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Paper trade and track symbols in your short-term and long-term buckets.
        </p>
      </div>

      {/* Paper Trading */}
      <PaperTrading />

      {/* Divider */}
      <div className="border-t" style={{ borderColor: "var(--color-border)" }} />

      {/* Watchlists */}
      <div>
        <h2 className="text-xl font-bold mb-4" style={{ color: "var(--color-fg)" }}>Watchlists</h2>
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
    </div>
  );
}
