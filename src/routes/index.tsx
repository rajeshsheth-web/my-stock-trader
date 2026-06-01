import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { getTopMovers, getDayTradeRecs } from '@/server/movers'
import type { DayTradeRec } from '@/server/movers'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPrice(n: number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

function fmtAbbrev(n: number) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

type Category = 'gainers' | 'losers' | 'active' | 'recs'
type Mover = {
  symbol: string
  shortName: string
  regularMarketPrice: number
  regularMarketChangePercent: number
  regularMarketVolume: number
}

const TABS: { key: Category; label: string }[] = [
  { key: 'gainers', label: 'Gainers' },
  { key: 'losers', label: 'Losers' },
  { key: 'active', label: 'Most Active' },
  { key: 'recs', label: '⚡ Day Trade Picks' },
]

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/')({
  validateSearch: (s: Record<string, unknown>) => ({
    cat: (s.cat as Category) ?? 'gainers',
  }),
  component: MoversPage,
})

// ─── Shared skeleton ──────────────────────────────────────────────────────────

function SkeletonRow({ cols = 4 }: { cols?: number }) {
  return (
    <div
      className="flex items-center gap-4 px-4 py-3 animate-pulse border-b"
      style={{ borderColor: 'var(--color-border)' }}
    >
      {Array.from({ length: cols }).map((_, i) => (
        <div key={i} className={`h-4 rounded bg-[var(--color-border)] ${i === 1 ? 'flex-1' : 'w-16'}`} />
      ))}
    </div>
  )
}

// ─── Movers table (gainers / losers / active) ─────────────────────────────────

function MoversTable({ cat }: { cat: 'gainers' | 'losers' | 'active' }) {
  const navigate = useNavigate()
  const [movers, setMovers] = useState<Mover[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    getTopMovers({ data: cat })
      .then((data) => { setMovers(data as Mover[]); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [cat])

  return (
    <div className="card p-0 overflow-hidden">
      <div
        className="grid grid-cols-[2fr_3fr_1fr_1fr] gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide border-b"
        style={{ color: 'var(--color-muted)', borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <span>Symbol</span><span>Name</span>
        <span className="text-right">Price</span><span className="text-right">Change %</span>
      </div>

      {loading && Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} />)}

      {!loading && error && (
        <div className="py-12 text-center">
          <p className="text-sm" style={{ color: 'var(--color-bear)' }}>Failed to load. Please try again.</p>
        </div>
      )}

      {!loading && !error && movers.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No data available. Markets may be closed.</p>
        </div>
      )}

      {!loading && !error && movers.map((m) => {
        const isUp = m.regularMarketChangePercent >= 0
        const sign = isUp ? '+' : ''
        const pctClass = isUp ? 'price-up' : 'price-down'
        return (
          <button
            key={m.symbol}
            onClick={() => navigate({ to: '/chart', search: { symbol: m.symbol, tab: 'Summary' } })}
            className="w-full grid grid-cols-[2fr_3fr_1fr_1fr] gap-2 px-4 py-3 text-sm text-left hover:bg-[var(--color-surface)] transition-colors border-b last:border-0"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <span className="font-semibold" style={{ color: 'var(--color-primary)' }}>{m.symbol}</span>
            <span className="truncate" style={{ color: 'var(--color-muted)' }}>{m.shortName}</span>
            <span className="text-right tabular-nums font-medium" style={{ color: 'var(--color-fg)' }}>{fmtPrice(m.regularMarketPrice)}</span>
            <span className={`text-right tabular-nums ${pctClass}`}>{sign}{m.regularMarketChangePercent.toFixed(2)}%</span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Score badge ──────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? 'var(--color-bull)' : score >= 45 ? '#d97706' : 'var(--color-muted)'
  const label = score >= 70 ? 'Strong' : score >= 45 ? 'Moderate' : 'Weak'
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)` }}
    >
      {score} · {label}
    </span>
  )
}

// ─── Day Trade Picks ──────────────────────────────────────────────────────────

function DayTradePicks() {
  const navigate = useNavigate()
  const [recs, setRecs] = useState<DayTradeRec[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(false)
    getDayTradeRecs()
      .then((data) => { setRecs(data as DayTradeRec[]); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [])

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="card flex items-start gap-3">
        <div className="text-2xl leading-none select-none">⚡</div>
        <div>
          <p className="font-semibold text-sm" style={{ color: 'var(--color-fg)' }}>
            Day Trade Picks — 2–5% ROI target
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Stocks showing volume surge + intraday momentum. Scored on conviction,
            range, and structure. Entry is current ask; use a 1% stop-loss.
            <span className="ml-1 font-medium" style={{ color: 'var(--color-bear)' }}>
              Not financial advice.
            </span>
          </p>
        </div>
      </div>

      {loading && (
        <div className="card p-0 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={6} />)}
        </div>
      )}

      {!loading && error && (
        <div className="card py-12 text-center">
          <p className="text-sm" style={{ color: 'var(--color-bear)' }}>
            Failed to load recommendations. Markets may be closed.
          </p>
        </div>
      )}

      {!loading && !error && recs.length === 0 && (
        <div className="card py-12 text-center space-y-2">
          <p className="font-semibold" style={{ color: 'var(--color-fg)' }}>No picks right now</p>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            No stocks currently meet the liquidity + momentum criteria.
            Try again during active market hours (9:30 AM – 4:00 PM ET).
          </p>
        </div>
      )}

      {!loading && !error && recs.map((rec) => {
        const roiPct = ((rec.target - rec.entry) / rec.entry * 100).toFixed(1)
        const riskPct = ((rec.entry - rec.stop) / rec.entry * 100).toFixed(1)
        const isOpen = expanded === rec.symbol

        return (
          <div key={rec.symbol} className="card p-0 overflow-hidden">
            {/* Summary row */}
            <button
              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-[var(--color-surface)] transition-colors"
              onClick={() => setExpanded(isOpen ? null : rec.symbol)}
            >
              {/* Rank/score */}
              <ScoreBadge score={rec.score} />

              {/* Ticker + name */}
              <div className="flex-1 min-w-0">
                <span className="font-bold text-sm" style={{ color: 'var(--color-primary)' }}>
                  {rec.symbol}
                </span>
                <span className="ml-2 text-xs truncate" style={{ color: 'var(--color-muted)' }}>
                  {rec.shortName}
                </span>
              </div>

              {/* Price + change */}
              <div className="text-right shrink-0">
                <div className="font-semibold tabular-nums text-sm" style={{ color: 'var(--color-fg)' }}>
                  ${fmtPrice(rec.price)}
                </div>
                <div className="text-xs tabular-nums price-up">
                  +{rec.changePercent.toFixed(2)}%
                </div>
              </div>

              {/* Target ROI */}
              <div className="text-right shrink-0 hidden sm:block">
                <div className="text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>Target ROI</div>
                <div className="text-sm font-bold price-up">+{roiPct}%</div>
              </div>

              {/* Expand chevron */}
              <svg
                className="shrink-0 transition-transform"
                style={{ transform: isOpen ? 'rotate(180deg)' : 'none', color: 'var(--color-muted)' }}
                width="16" height="16" viewBox="0 0 16 16" fill="none"
              >
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {/* Expanded detail */}
            {isOpen && (
              <div
                className="border-t px-4 py-4 space-y-4"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
              >
                {/* Entry / Target / Stop grid */}
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg p-3" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                    <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--color-muted)' }}>Entry</div>
                    <div className="text-lg font-bold tabular-nums" style={{ color: 'var(--color-fg)' }}>${fmtPrice(rec.entry)}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>Market ask</div>
                  </div>
                  <div className="rounded-lg p-3" style={{ background: 'var(--color-bg)', border: `1px solid var(--color-bull)` }}>
                    <div className="text-xs font-semibold uppercase tracking-wide mb-1 price-up">Target</div>
                    <div className="text-lg font-bold tabular-nums price-up">${fmtPrice(rec.target)}</div>
                    <div className="text-xs price-up mt-0.5">+{roiPct}% ROI</div>
                  </div>
                  <div className="rounded-lg p-3" style={{ background: 'var(--color-bg)', border: `1px solid var(--color-bear)` }}>
                    <div className="text-xs font-semibold uppercase tracking-wide mb-1 price-down">Stop</div>
                    <div className="text-lg font-bold tabular-nums price-down">${fmtPrice(rec.stop)}</div>
                    <div className="text-xs price-down mt-0.5">−{riskPct}% risk</div>
                  </div>
                </div>

                {/* Signals + stats */}
                <div className="flex flex-wrap gap-4 text-sm">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Volume</span>
                    <div className="tabular-nums font-medium mt-0.5" style={{ color: 'var(--color-fg)' }}>
                      {fmtAbbrev(rec.volume)}
                      {rec.avgVolume > 0 && (
                        <span className="ml-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                          ({rec.volumeSurge.toFixed(1)}× avg)
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Intraday Range</span>
                    <div className="tabular-nums font-medium mt-0.5" style={{ color: 'var(--color-fg)' }}>
                      {rec.intradayRange.toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Risk/Reward</span>
                    <div className="tabular-nums font-medium mt-0.5" style={{ color: 'var(--color-fg)' }}>
                      1 : {(Number(roiPct) / Number(riskPct)).toFixed(1)}
                    </div>
                  </div>
                </div>

                {/* Signals list */}
                {rec.signals.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {rec.signals.map((sig) => (
                      <span
                        key={sig}
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{
                          background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
                          color: 'var(--color-primary)',
                          border: '1px solid color-mix(in srgb, var(--color-primary) 25%, transparent)',
                        }}
                      >
                        {sig}
                      </span>
                    ))}
                  </div>
                )}

                {/* View chart CTA */}
                <button
                  onClick={() => navigate({ to: '/chart', search: { symbol: rec.symbol, tab: 'Chart' } })}
                  className="btn-primary text-sm w-full sm:w-auto"
                >
                  View {rec.symbol} chart →
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function MoversPage() {
  const { cat } = Route.useSearch()
  const navigate = useNavigate()

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold" style={{ color: 'var(--color-fg)' }}>Market Movers</h1>

      {/* Tab bar */}
      <div className="flex border-b" style={{ borderColor: 'var(--color-border)' }}>
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => navigate({ to: '/', search: { cat: key } })}
            className="px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors"
            style={
              cat === key
                ? { borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }
                : { borderColor: 'transparent', color: 'var(--color-muted)' }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {cat === 'recs' ? (
        <DayTradePicks />
      ) : (
        <MoversTable cat={cat} />
      )}
    </div>
  )
}
