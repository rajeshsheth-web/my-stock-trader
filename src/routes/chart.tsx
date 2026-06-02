import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useEffect, lazy, Suspense } from 'react'
import { getStockOverview, getStockQuote, getStockStats, getStockNews, getRangeCandles } from '@/server/stock'
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
    if (q.marketState === 'REGULAR') return null
    if (isPreMarket(q.marketState) && q.preMarketPrice != null)
      return { price: q.preMarketPrice, change: q.preMarketChange ?? null, pct: q.preMarketChangePercent ?? null, label: 'Pre-Market' }
    if (q.postMarketPrice != null)
      return { price: q.postMarketPrice, change: q.postMarketChange ?? null, pct: q.postMarketChangePercent ?? null, label: isPostMarket(q.marketState) ? 'After Hours' : 'Closed' }
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
        if (ms === 'REGULAR') {
          setExtData(null)
        } else if ((ms === 'PRE' || ms === 'PREPRE') && q.preMarketPrice != null) {
          setExtData({ price: q.preMarketPrice, change: q.preMarketChange ?? null, pct: q.preMarketChangePercent ?? null, label: 'Pre-Market' })
        } else if (q.postMarketPrice != null) {
          setExtData({ price: q.postMarketPrice, change: q.postMarketChange ?? null, pct: q.postMarketChangePercent ?? null, label: (ms === 'POST' || ms === 'POSTPOST') ? 'After Hours' : 'Closed' })
        }
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
      .then(v => { setVerdict(v ?? null); setLoading(false) })
      .catch(() => { setVerdict({ error: 'api_error' }); setLoading(false) })
  }, [stock.symbol])

  const hasVerdict = verdict && !('error' in verdict)
  const ratingStyle = hasVerdict ? (RATING_STYLE[(verdict as any).rating] ?? RATING_STYLE['Hold']) : null

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>AI Verdict</span>
        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
          Short-term · 1–5 days
        </span>
        {hasVerdict && ratingStyle && (
          <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded" style={{ background: ratingStyle.bg, color: ratingStyle.color }}>
            {(verdict as any).rating}
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

      {!loading && verdict && 'error' in verdict && verdict.error === 'no_key' && (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Add <code className="text-xs px-1 rounded" style={{ background: 'var(--color-surface)' }}>GEMINI_API_KEY</code> to Vercel environment variables and redeploy.
        </p>
      )}

      {!loading && verdict && 'error' in verdict && verdict.error === 'api_error' && (
        <div className="space-y-1">
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            AI analysis failed — check your API key is valid and has available credits.
          </p>
          {(verdict as any).detail && (
            <p className="text-xs font-mono break-all" style={{ color: 'var(--color-muted)' }}>
              {(verdict as any).detail}
            </p>
          )}
        </div>
      )}

      {!loading && hasVerdict && (() => {
        const v = verdict as Extract<AiVerdict, { rating: string }>
        return (
          <div className="space-y-2">
            <p className="text-sm font-medium" style={{ color: 'var(--color-fg)' }}>{v.summary}</p>
            <ul className="space-y-1 mt-2">
              {v.bullets.map((b, i) => (
                <li key={i} className="flex gap-2 text-sm" style={{ color: 'var(--color-fg)' }}>
                  <span style={{ color: 'var(--color-primary)', flexShrink: 0 }}>•</span>
                  {b}
                </li>
              ))}
            </ul>
            <p className="text-xs mt-3 pt-2 border-t" style={{ color: 'var(--color-muted)', borderColor: 'var(--color-border)' }}>
              {v.disclaimer}
            </p>
          </div>
        )
      })()}
    </div>
  )
}

// ─── Statistics tab ───────────────────────────────────────────────────────────

function fmtDollarAbbrev(n: number | null) {
  if (n == null) return 'N/A'
  const abs = Math.abs(n)
  if (abs >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T'
  if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'
  if (abs >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'
  if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K'
  return '$' + n.toFixed(2)
}

function fmtPct(n: number | null) {
  if (n == null) return 'N/A'
  return (n * 100).toFixed(2) + '%'
}

function fmtNum(n: number | null, decimals = 2) {
  if (n == null) return 'N/A'
  return n.toFixed(decimals)
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-2 border-b last:border-0" style={{ borderColor: 'var(--color-border)' }}>
      <span className="text-sm" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--color-fg)' }}>{value}</span>
    </div>
  )
}

function StatSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex justify-between py-2">
          <span className="h-4 rounded bg-[var(--color-border)] w-28" />
          <span className="h-4 rounded bg-[var(--color-border)] w-20" />
        </div>
      ))}
    </div>
  )
}

function StatisticsTab({ symbol }: { symbol: string }) {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getStockStats>> | undefined>(undefined)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getStockStats({ data: symbol }).then(s => { setStats(s); setLoading(false) }).catch(() => setLoading(false))
  }, [symbol])

  const sections = stats ? [
    {
      title: 'Valuation',
      rows: [
        { label: 'Market Cap', value: fmtDollarAbbrev(stats.marketCap) },
        { label: 'P/E (TTM)', value: fmtNum(stats.peRatio) },
        { label: 'Forward P/E', value: fmtNum(stats.forwardPE) },
        { label: 'EPS (TTM)', value: stats.eps != null ? '$' + fmtNum(stats.eps) : 'N/A' },
        { label: 'Forward EPS', value: stats.forwardEps != null ? '$' + fmtNum(stats.forwardEps) : 'N/A' },
        { label: 'Price/Book', value: fmtNum(stats.priceToBook) },
      ],
    },
    {
      title: 'Dividends & Risk',
      rows: [
        { label: 'Dividend Yield', value: fmtPct(stats.dividendYield) },
        { label: 'Beta', value: fmtNum(stats.beta) },
      ],
    },
    {
      title: 'Shares',
      rows: [
        { label: 'Shares Outstanding', value: stats.sharesOutstanding != null ? fmtAbbrev(stats.sharesOutstanding) : 'N/A' },
        { label: 'Float', value: stats.floatShares != null ? fmtAbbrev(stats.floatShares) : 'N/A' },
      ],
    },
    {
      title: 'Financials',
      rows: [
        { label: 'Revenue (TTM)', value: fmtDollarAbbrev(stats.revenue) },
        { label: 'Gross Margin', value: fmtPct(stats.grossMargins) },
        { label: 'Profit Margin', value: fmtPct(stats.profitMargins) },
        { label: 'Debt/Equity', value: fmtNum(stats.debtToEquity) },
        { label: 'ROE', value: fmtPct(stats.returnOnEquity) },
        { label: 'Current Ratio', value: fmtNum(stats.currentRatio) },
      ],
    },
  ] : []

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {loading
        ? [0, 1, 2, 3].map(i => (
          <div key={i} className="card">
            <StatSkeleton />
          </div>
        ))
        : !stats
          ? <div className="card col-span-2 py-12 text-center"><p className="text-sm" style={{ color: 'var(--color-muted)' }}>Statistics not available for this symbol.</p></div>
          : sections.map(sec => (
            <div key={sec.title} className="card">
              <h3 className="text-xs font-semibold uppercase mb-2" style={{ color: 'var(--color-muted)' }}>{sec.title}</h3>
              {sec.rows.map(r => <StatRow key={r.label} label={r.label} value={r.value} />)}
            </div>
          ))
      }
    </div>
  )
}

// ─── Historical tab ───────────────────────────────────────────────────────────

type HistoricalRange = '1W' | '1M' | '3M' | '6M' | '1Y'
const HIST_CONFIG: Record<HistoricalRange, { range: string; interval: string }> = {
  '1W': { range: '5d',  interval: '1d' },
  '1M': { range: '1mo', interval: '1d' },
  '3M': { range: '3mo', interval: '1d' },
  '6M': { range: '6mo', interval: '1d' },
  '1Y': { range: '1y',  interval: '1wk' },
}

function fmtVolume(n: number) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

function fmtHistDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function HistoricalTab({ symbol }: { symbol: string }) {
  const [range, setRange] = useState<HistoricalRange>('1M')
  const [candles, setCandles] = useState<Awaited<ReturnType<typeof getRangeCandles>>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const { range: r, interval: i } = HIST_CONFIG[range]
    getRangeCandles({ data: { symbol, range: r, interval: i } })
      .then(c => { setCandles(c); setLoading(false) })
      .catch(() => setLoading(false))
  }, [symbol, range])

  function downloadCsv() {
    const rows = [...candles].reverse()
    const header = 'Date,Open,High,Low,Close,Volume'
    const lines = rows.map(c => `${fmtHistDate(c.time)},${c.open.toFixed(2)},${c.high.toFixed(2)},${c.low.toFixed(2)},${c.close.toFixed(2)},${c.volume}`)
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${symbol}_${range}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const displayCandles = [...candles].reverse()

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1">
          {(['1W', '1M', '3M', '6M', '1Y'] as HistoricalRange[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className="px-3 py-1 text-xs font-medium rounded transition-colors"
              style={range === r
                ? { background: 'var(--color-primary)', color: '#fff' }
                : { background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
            >
              {r}
            </button>
          ))}
        </div>
        <button onClick={downloadCsv} className="btn-ghost text-xs py-1 px-2" style={{ color: 'var(--color-muted)' }}>
          Download CSV
        </button>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-8 rounded bg-[var(--color-border)]" />
          ))}
        </div>
      ) : displayCandles.length === 0 ? (
        <p className="text-sm text-center py-8" style={{ color: 'var(--color-muted)' }}>No data available.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--color-border)' }}>
                {['Date', 'Open', 'High', 'Low', 'Close', 'Volume'].map(h => (
                  <th key={h} className="text-left pb-2 pr-4 text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayCandles.map((c, i) => (
                <tr key={i} className="border-b last:border-0" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="py-2 pr-4 tabular-nums" style={{ color: 'var(--color-fg)' }}>{fmtHistDate(c.time)}</td>
                  <td className="py-2 pr-4 tabular-nums" style={{ color: 'var(--color-fg)' }}>{c.open.toFixed(2)}</td>
                  <td className="py-2 pr-4 tabular-nums" style={{ color: 'var(--color-fg)' }}>{c.high.toFixed(2)}</td>
                  <td className="py-2 pr-4 tabular-nums" style={{ color: 'var(--color-fg)' }}>{c.low.toFixed(2)}</td>
                  <td className="py-2 pr-4 tabular-nums font-semibold" style={{ color: 'var(--color-fg)' }}>{c.close.toFixed(2)}</td>
                  <td className="py-2 tabular-nums" style={{ color: 'var(--color-muted)' }}>{fmtVolume(c.volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── News tab ─────────────────────────────────────────────────────────────────

function timeAgo(ts: number) {
  const diff = Math.floor(Date.now() / 1000) - ts
  if (diff < 60) return 'just now'
  if (diff < 3600) return Math.floor(diff / 60) + ' minutes ago'
  if (diff < 86400) return Math.floor(diff / 3600) + ' hours ago'
  if (diff < 2592000) return Math.floor(diff / 86400) + ' days ago'
  return Math.floor(diff / 2592000) + ' months ago'
}

function NewsTab({ symbol }: { symbol: string }) {
  const [news, setNews] = useState<Awaited<ReturnType<typeof getStockNews>>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getStockNews({ data: symbol }).then(n => { setNews(n); setLoading(false) }).catch(() => setLoading(false))
  }, [symbol])

  if (loading) {
    return (
      <div className="card animate-pulse space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-4 rounded bg-[var(--color-border)] w-3/4" />
            <div className="h-3 rounded bg-[var(--color-border)] w-32" />
          </div>
        ))}
      </div>
    )
  }

  if (news.length === 0) {
    return <div className="card py-12 text-center"><p className="text-sm" style={{ color: 'var(--color-muted)' }}>No news available.</p></div>
  }

  return (
    <div className="card divide-y" style={{ borderColor: 'var(--color-border)' }}>
      {news.map(item => (
        <div key={item.uuid} className="py-4 first:pt-0 last:pb-0">
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium hover:underline"
            style={{ color: 'var(--color-fg)' }}
          >
            {item.title}
          </a>
          <p className="mt-1 text-xs" style={{ color: 'var(--color-muted)' }}>
            {item.publisher} · {timeAgo(item.providerPublishTime)}
          </p>
        </div>
      ))}
    </div>
  )
}

// ─── Holders tab ──────────────────────────────────────────────────────────────

function HoldersTab({ symbol }: { symbol: string }) {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getStockStats>> | undefined>(undefined)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getStockStats({ data: symbol }).then(s => { setStats(s); setLoading(false) }).catch(() => setLoading(false))
  }, [symbol])

  const holders = stats?.institutionalHolders ?? []

  if (loading) {
    return (
      <div className="card animate-pulse space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-8 rounded bg-[var(--color-border)]" />
        ))}
      </div>
    )
  }

  if (!stats || holders.length === 0) {
    return (
      <div className="card py-12 text-center">
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Holder data not available for this symbol.</p>
      </div>
    )
  }

  return (
    <div className="card">
      <h3 className="text-xs font-semibold uppercase mb-4" style={{ color: 'var(--color-muted)' }}>Top Institutional Holders</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--color-border)' }}>
              {['Name', 'Shares', '% Held', 'Report Date'].map(h => (
                <th key={h} className="text-left pb-2 pr-4 text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {holders.map((h: any, i: number) => (
              <tr key={i} className="border-b last:border-0" style={{ borderColor: 'var(--color-border)' }}>
                <td className="py-2 pr-4 font-medium" style={{ color: 'var(--color-fg)' }}>{h.name || '—'}</td>
                <td className="py-2 pr-4 tabular-nums" style={{ color: 'var(--color-fg)' }}>{h.shares != null ? fmtAbbrev(h.shares) : '—'}</td>
                <td className="py-2 pr-4 tabular-nums" style={{ color: 'var(--color-fg)' }}>{h.pctHeld != null ? (h.pctHeld * 100).toFixed(2) + '%' : '—'}</td>
                <td className="py-2 tabular-nums" style={{ color: 'var(--color-muted)' }}>{h.reportDate != null ? fmtHistDate(h.reportDate) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
      {tab === 'Statistics' && <StatisticsTab symbol={symbol} />}
      {tab === 'Historical' && <HistoricalTab symbol={symbol} />}
      {tab === 'News' && <NewsTab symbol={symbol} />}
      {tab === 'Holders' && <HoldersTab symbol={symbol} />}
    </div>
  )
}
