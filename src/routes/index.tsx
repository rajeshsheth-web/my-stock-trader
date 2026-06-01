import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { getStockOverview } from '@/server/stock'
import { useAuth } from './__root'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPrice(n: number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

function fmtAbbrev(n: number) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

const TABS = ['Summary', 'Chart', 'Statistics', 'Historical', 'News', 'Holders'] as const
type Tab = typeof TABS[number]

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/')({
  validateSearch: (s: Record<string, unknown>) => ({
    symbol: (s.symbol as string) ?? 'AAPL',
    tab: (s.tab as Tab) ?? 'Summary',
  }),
  loaderDeps: ({ search }) => ({ symbol: search.symbol }),
  loader: async ({ deps }) => {
    const data = await getStockOverview({ data: deps.symbol })
    return { stock: data }
  },
  component: IndexPage,
})

// ─── Components ───────────────────────────────────────────────────────────────

function SkeletonRow({ w = 'w-24' }: { w?: string }) {
  return <span className={`inline-block h-4 rounded animate-pulse bg-[var(--color-border)] ${w}`} />
}

function TickerSearch() {
  const navigate = useNavigate()
  const { symbol } = Route.useSearch()
  const [input, setInput] = useState(symbol)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const sym = input.trim().toUpperCase()
    if (sym) navigate({ to: '/', search: { symbol: sym, tab: 'Summary' } })
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        value={input}
        onChange={e => setInput(e.target.value.toUpperCase())}
        placeholder="Symbol…"
        className="rounded-md border px-3 py-1.5 text-sm w-28 outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-fg)' }}
      />
      <button type="submit" className="btn-primary text-sm py-1.5">Go</button>
    </form>
  )
}

function QuoteHeader({ stock }: { stock: NonNullable<ReturnType<typeof Route.useLoaderData>['stock']> }) {
  const navigate = useNavigate()
  const { tab } = Route.useSearch()
  const { session, supabase } = useAuth()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const change = stock.regularMarketChange
  const pct = stock.regularMarketChangePercent
  const isUp = change >= 0
  const priceClass = isUp ? 'price-up' : 'price-down'
  const sign = isUp ? '+' : ''

  async function addToWatchlist() {
    if (!session) {
      navigate({ to: '/auth' })
      return
    }
    setSaving(true)
    try {
      // Try update first; if no row, insert
      const userId = session.user.id
      const { data: existing } = await supabase
        .from('portfolios')
        .select('id, symbols')
        .eq('user_id', userId)
        .eq('bucket', 'short')
        .single()

      if (existing) {
        if (!existing.symbols.includes(stock.symbol)) {
          await supabase
            .from('portfolios')
            .update({ symbols: [...existing.symbols, stock.symbol] })
            .eq('id', existing.id)
        }
      } else {
        await supabase.from('portfolios').insert({
          user_id: userId,
          bucket: 'short',
          symbols: [stock.symbol],
        })
      }
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="sticky top-14 z-40 border-b"
      style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
    >
      <div className="py-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        {/* Left: name + price */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold truncate" style={{ color: 'var(--color-fg)' }}>
              {stock.shortName}
            </h1>
            <span className="text-sm font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}>
              {stock.symbol}
            </span>
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{stock.exchangeName}</span>
          </div>
          <div className="mt-1 flex items-baseline gap-3 flex-wrap">
            <span className={`text-3xl font-bold tabular-nums ${priceClass}`}>
              {fmtPrice(stock.regularMarketPrice)}
            </span>
            <span className={`text-base tabular-nums ${priceClass}`}>
              {sign}{fmtPrice(change)} ({sign}{pct.toFixed(2)}%)
            </span>
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Vol: {fmtAbbrev(stock.regularMarketVolume)}
            </span>
          </div>
        </div>
        {/* Right: actions */}
        <div className="flex items-center gap-2 shrink-0">
          <TickerSearch />
          <button
            onClick={addToWatchlist}
            disabled={saving || saved}
            className="btn-primary text-sm"
          >
            {saved ? 'Added ✓' : saving ? 'Saving…' : '+ Watchlist'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <nav className="flex gap-0 -mb-px overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => navigate({ to: '/', search: s => ({ ...s, tab: t }) })}
            className="px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors"
            style={tab === t
              ? { borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }
              : { borderColor: 'transparent', color: 'var(--color-muted)' }}
          >
            {t}
          </button>
        ))}
      </nav>
    </div>
  )
}

function KeyStats({ stock }: { stock: NonNullable<ReturnType<typeof Route.useLoaderData>['stock']> }) {
  const rows = [
    { label: 'Open', value: fmtPrice(stock.regularMarketOpen) },
    { label: 'High', value: fmtPrice(stock.regularMarketDayHigh) },
    { label: 'Low', value: fmtPrice(stock.regularMarketDayLow) },
    { label: 'Prev Close', value: fmtPrice(stock.previousClose) },
    { label: 'Volume', value: fmtAbbrev(stock.regularMarketVolume) },
    { label: 'Mkt Cap', value: stock.marketCap ? fmtAbbrev(stock.marketCap) : '—' },
    { label: '52W High', value: fmtPrice(stock.fiftyTwoWeekHigh) },
    { label: '52W Low', value: fmtPrice(stock.fiftyTwoWeekLow) },
  ]
  return (
    <div className="card">
      <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-muted)' }}>KEY STATISTICS</h2>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
        {rows.map(({ label, value }) => (
          <div key={label}>
            <dt className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums" style={{ color: 'var(--color-fg)' }}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function AiVerdictSkeleton() {
  return (
    <div className="card space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>AI Verdict</span>
        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>Coming in M4</span>
      </div>
      <div className="space-y-2 animate-pulse">
        <div className="h-3 rounded bg-[var(--color-border)] w-3/4" />
        <div className="h-3 rounded bg-[var(--color-border)] w-1/2" />
        <div className="h-3 rounded bg-[var(--color-border)] w-5/6" />
      </div>
      <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>AI analysis loading…</p>
    </div>
  )
}

function ComingSoon({ label }: { label: string }) {
  return (
    <div className="card flex items-center justify-center py-12 text-center">
      <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{label}</p>
    </div>
  )
}

function IndexPage() {
  const { stock } = Route.useLoaderData()
  const { symbol, tab } = Route.useSearch()

  if (!stock) {
    return (
      <div className="space-y-4">
        <div className="py-4 flex items-center justify-between gap-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-sm font-medium" style={{ color: 'var(--color-bear)' }}>
            Could not load {symbol} — markets may be closed or symbol is invalid.
          </p>
          <TickerSearch />
        </div>
        <div className="card py-16 text-center space-y-2">
          <p className="font-semibold" style={{ color: 'var(--color-fg)' }}>No data available</p>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Try a different symbol or check back during market hours.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <QuoteHeader stock={stock} />

      {tab === 'Summary' && (
        <div className="space-y-4">
          <AiVerdictSkeleton />
          <KeyStats stock={stock} />
          <ComingSoon label="Interactive chart coming in M3" />
        </div>
      )}
      {tab === 'Chart' && <ComingSoon label="Chart coming in M3" />}
      {tab === 'Statistics' && <ComingSoon label="Detailed statistics coming soon" />}
      {tab === 'Historical' && <ComingSoon label="Historical data coming soon" />}
      {tab === 'News' && <ComingSoon label="News feed coming soon" />}
      {tab === 'Holders' && <ComingSoon label="Holder data coming soon" />}
    </div>
  )
}
