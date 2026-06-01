import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { getTopMovers } from '@/server/movers'

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

type Category = 'gainers' | 'losers' | 'active'
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
]

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/movers')({
  validateSearch: (s: Record<string, unknown>) => ({
    cat: (s.cat as Category) ?? 'gainers',
  }),
  component: MoversPage,
})

// ─── Component ────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-4 py-3 animate-pulse border-b" style={{ borderColor: 'var(--color-border)' }}>
      <div className="h-4 rounded bg-[var(--color-border)] w-16" />
      <div className="flex-1 h-4 rounded bg-[var(--color-border)] w-32" />
      <div className="h-4 rounded bg-[var(--color-border)] w-16" />
      <div className="h-4 rounded bg-[var(--color-border)] w-14" />
    </div>
  )
}

function MoversPage() {
  const navigate = useNavigate()
  const { cat } = Route.useSearch()
  const [movers, setMovers] = useState<Mover[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    getTopMovers({ data: cat })
      .then(data => { setMovers(data as Mover[]); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [cat])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-fg)' }}>Top Movers</h1>
      </div>

      {/* Tab bar */}
      <div className="flex border-b" style={{ borderColor: 'var(--color-border)' }}>
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => navigate({ to: '/movers', search: { cat: key } })}
            className="px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors"
            style={cat === key
              ? { borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }
              : { borderColor: 'transparent', color: 'var(--color-muted)' }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="card p-0 overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-[2fr_3fr_1fr_1fr] gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide border-b" style={{ color: 'var(--color-muted)', borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <span>Symbol</span>
          <span>Name</span>
          <span className="text-right">Price</span>
          <span className="text-right">Change %</span>
        </div>

        {loading && (
          <>
            {Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} />)}
          </>
        )}

        {!loading && error && (
          <div className="py-12 text-center">
            <p className="text-sm" style={{ color: 'var(--color-bear)' }}>Failed to load movers. Please try again.</p>
          </div>
        )}

        {!loading && !error && movers.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No data available. Markets may be closed.</p>
          </div>
        )}

        {!loading && !error && movers.map((m, i) => {
          const isUp = m.regularMarketChangePercent >= 0
          const sign = isUp ? '+' : ''
          const pctClass = isUp ? 'price-up' : 'price-down'
          return (
            <button
              key={m.symbol}
              onClick={() => navigate({ to: '/', search: { symbol: m.symbol, tab: 'Summary' } })}
              className="w-full grid grid-cols-[2fr_3fr_1fr_1fr] gap-2 px-4 py-3 text-sm text-left hover:bg-[var(--color-surface)] transition-colors border-b last:border-0"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <span className="font-semibold tabular-nums" style={{ color: 'var(--color-primary)' }}>{m.symbol}</span>
              <span className="truncate" style={{ color: 'var(--color-muted)' }}>{m.shortName}</span>
              <span className="text-right tabular-nums font-medium" style={{ color: 'var(--color-fg)' }}>{fmtPrice(m.regularMarketPrice)}</span>
              <span className={`text-right tabular-nums ${pctClass}`}>{sign}{m.regularMarketChangePercent.toFixed(2)}%</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
