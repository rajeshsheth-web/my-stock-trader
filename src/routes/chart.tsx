import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useEffect, lazy, Suspense } from 'react'
import { getStockOverview, getStockQuote } from '@/server/stock'
import { getAiVerdict, type AiVerdict } from '@/server/ai'
import { useAuth } from './__root'

const YFChart = lazy(() => import('@/components/YFChart').then(m => ({ default: m.YFChart })))

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

export const Route = createFileRoute('/chart')({
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
    if (sym) navigate({ to: '/chart', search: { symbol: sym, tab: 'Summary' } })
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

function MarketStateBadge({ state }: { state: string }) {
  const cfg: Record<string, { label: string; bg: string; color: string }> = {
    REGULAR:  { label: 'Market Open',   bg: 'rgba(0,135,60,0.12)',   color: '#00873c' },
    PRE:      { label: 'Pre-Market',    bg: 'rgba(217,119,6,0.12)',  color: '#d97706' },
    PREPRE:   { label: 'Pre-Market',    bg: 'rgba(217,119,6,0.12)',  color: '#d97706' },
    POST:     { label: 'After Hours',   bg: 'rgba(217,119,6,0.12)',  color: '#d97706' },
    POSTPOST: { label: 'After Hours',   bg: 'rgba(217,119,6,0.12)',  color: '#d97706' },
    CLOSED:   { label: 'Market Closed', bg: 'rgba(107,114,128,0.12)', color: '#6b7280' },
  }
  const c = cfg[state] ?? cfg.CLOSED
  return (
    <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ background: c.bg, color: c.color, border: `1px solid ${c.color}33` }}>
      {c.label}
    </span>
  )
}

function QuoteHeader({ stock }: { stock: NonNullable<ReturnType<typeof Route.useLoaderData>['stock']> }) {
  const navigate = useNavigate()
  const { tab } = Route.useSearch()
  const { session, supabase } = useAuth()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [livePrice, setLivePrice] = useState(stock.regularMarketPrice)
  const [liveChange, setLiveChange] = useState(stock.regularMarketChange)
  const [livePct, setLivePct] = useState(stock.regularMarketChangePercent)
  const isPreMarket = (s: string) => s === 'PRE' || s === 'PREPRE'
  const isPostMarket = (s: string) => s === 'POST' || s === 'POSTPOST'

  function extInfo(q: typeof stock) {
    if (isPreMarket(q.marketState) && q.preMarketPrice != null)
      return { price: q.preMarketPrice, change: q.preMarketChange ?? null, pct: q.preMarketChangePercent ?? null, label: 'Pre-Market' }
    if ((isPostMarket(q.marketState) || q.marketState === 'CLOSED') && q.postMarketPrice != null)
      return { price: q.postMarketPrice, change: q.postMarketChange ?? null, pct: q.postMarketChangePercent ?? null, label: 'After Hours' }
    return null
  }

  const [extData, setExtData] = useState(() => extInfo(stock))
  const [marketState, setMarketState] = useState(stock.marketState)

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const q = await getStockQuote({ data: stock.symbol })
        if (!q) return
        setLivePrice(q.price)
        setLiveChange(q.change)
        setLivePct(q.changePct)
        setMarketState(q.marketState)
        const ms = q.marketState
        if ((ms === 'PRE' || ms === 'PREPRE') && q.preMarketPrice != null)
          setExtData({ price: q.preMarketPrice, change: q.preMarketChange ?? null, pct: q.preMarketChangePercent ?? null, label: 'Pre-Market' })
        else if ((ms === 'POST' || ms === 'POSTPOST' || ms === 'CLOSED') && q.postMarketPrice != null)
          setExtData({ price: q.postMarketPrice, change: q.postMarketChange ?? null, pct: q.postMarketChangePercent ?? null, label: 'After Hours' })
        else
          setExtData(null)
      } catch {}
    }, 10_000)
    return () => clearInterval(id)
  }, [stock.symbol])

  const change = liveChange
  const pct = livePct
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
            <MarketStateBadge state={marketState} />
          </div>
          <div className="mt-1 flex items-baseline gap-3 flex-wrap">
            <span className={`text-3xl font-bold tabular-nums ${priceClass}`}>
              {fmtPrice(livePrice)}
            </span>
            <span className={`text-base tabular-nums ${priceClass}`}>
              {sign}{fmtPrice(change)} ({sign}{pct.toFixed(2)}%)
            </span>
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Vol: {fmtAbbrev(stock.regularMarketVolume)}
            </span>
          </div>
          {extData != null && (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span
                className="text-xs font-semibold px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(217,119,6,0.1)', color: '#d97706', border: '1px solid rgba(217,119,6,0.3)' }}
              >
                {extData.label}
              </span>
              <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--color-fg)' }}>
                {fmtPrice(extData.price)}
              </span>
              {extData.change != null && extData.pct != null && (() => {
                const sign = extData.change! >= 0 ? '+' : ''
                const cls = extData.change! >= 0 ? 'price-up' : 'price-down'
                return (
                  <span className={`text-xs tabular-nums ${cls}`}>
                    {sign}{fmtPrice(extData.change!)} ({sign}{extData.pct!.toFixed(2)}%)
                  </span>
                )
              })()}
            </div>
          )}
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
            onClick={() => navigate({ to: '/chart', search: s => ({ ...s, tab: t }) })}
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

const RATING_STYLE: Record<string, { bg: string; color: string }> = {
  'Strong Buy': { bg: 'rgba(0,135,60,0.12)',   color: '#00873c' },
  'Buy':        { bg: 'rgba(0,135,60,0.08)',   color: '#00873c' },
  'Hold':       { bg: 'rgba(217,119,6,0.12)',  color: '#d97706' },
  'Sell':       { bg: 'rgba(235,15,41,0.08)',  color: '#eb0f29' },
  'Strong Sell':{ bg: 'rgba(235,15,41,0.12)',  color: '#eb0f29' },
}

function AiVerdictCard({ stock }: { stock: NonNullable<ReturnType<typeof Route.useLoaderData>['stock']> }) {
  const [verdict, setVerdict] = useState<AiVerdict | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setVerdict(null)
    getAiVerdict({
      data: {
        symbol: stock.symbol,
        shortName: stock.shortName,
        price: stock.regularMarketPrice,
        change: stock.regularMarketChange,
        changePct: stock.regularMarketChangePercent,
        open: stock.regularMarketOpen,
        high: stock.regularMarketDayHigh,
        low: stock.regularMarketDayLow,
        previousClose: stock.previousClose,
        volume: stock.regularMarketVolume,
        marketCap: stock.marketCap,
        fiftyTwoWeekHigh: stock.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: stock.fiftyTwoWeekLow,
        marketState: stock.marketState,
      },
    })
      .then(v => { setVerdict(v); setLoading(false) })
      .catch(() => setLoading(false))
  }, [stock.symbol])

  const ratingStyle = verdict ? (RATING_STYLE[verdict.rating] ?? RATING_STYLE['Hold']) : null

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>AI Verdict</span>
        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
          Short-term · 1–5 days
        </span>
        {verdict && ratingStyle && (
          <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded" style={{ background: ratingStyle.bg, color: ratingStyle.color }}>
            {verdict.rating}
          </span>
        )}
      </div>

      {loading && (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 rounded bg-[var(--color-border)] w-3/4" />
          <div className="h-3 rounded bg-[var(--color-border)] w-1/2" />
          <div className="h-3 rounded bg-[var(--color-border)] w-5/6" />
          <p className="text-xs pt-1" style={{ color: 'var(--color-muted)' }}>Analysing with AI…</p>
        </div>
      )}

      {!loading && !verdict && (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          AI analysis unavailable — add <code className="text-xs">ANTHROPIC_API_KEY</code> to your environment.
        </p>
      )}

      {!loading && verdict && (
        <div className="space-y-2">
          <p className="text-sm font-medium" style={{ color: 'var(--color-fg)' }}>{verdict.summary}</p>
          <ul className="space-y-1 mt-2">
            {verdict.bullets.map((b, i) => (
              <li key={i} className="flex gap-2 text-sm" style={{ color: 'var(--color-fg)' }}>
                <span style={{ color: 'var(--color-primary)', flexShrink: 0 }}>•</span>
                {b}
              </li>
            ))}
          </ul>
          <p className="text-xs mt-3 pt-2 border-t" style={{ color: 'var(--color-muted)', borderColor: 'var(--color-border)' }}>
            {verdict.disclaimer}
          </p>
        </div>
      )}
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

function ChartSkeleton() {
  return (
    <div
      className="card animate-pulse"
      style={{ height: 340, background: 'var(--color-surface)' }}
    />
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
          <AiVerdictCard stock={stock} />
          <Suspense fallback={<ChartSkeleton />}>
            <YFChart symbol={symbol} />
          </Suspense>
          <KeyStats stock={stock} />
        </div>
      )}
      {tab === 'Chart' && (
        <Suspense fallback={<ChartSkeleton />}>
          <YFChart symbol={symbol} />
        </Suspense>
      )}
      {tab === 'Statistics' && <ComingSoon label="Detailed statistics coming soon" />}
      {tab === 'Historical' && <ComingSoon label="Historical data coming soon" />}
      {tab === 'News' && <ComingSoon label="News feed coming soon" />}
      {tab === 'Holders' && <ComingSoon label="Holder data coming soon" />}
    </div>
  )
}
