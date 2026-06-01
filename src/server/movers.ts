import { createServerFn } from '@tanstack/react-start'

async function fetchWithTimeout(url: string, opts: RequestInit = {}, ms = 4500) {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), ms)
  try { return await fetch(url, { ...opts, signal: ctrl.signal }) }
  finally { clearTimeout(id) }
}

export const getTopMovers = createServerFn({ method: 'GET' })
  .inputValidator((cat: unknown) => {
    const c = cat as string
    if (!['gainers', 'losers', 'active'].includes(c)) return 'gainers'
    return c
  })
  .handler(async ({ data: category }) => {
    try {
      const scrIds: Record<string, string> = {
        gainers: 'day_gainers',
        losers: 'day_losers',
        active: 'most_actives',
      }
      const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=${scrIds[category]}&count=20`
      const r = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!r.ok) return []
      const json = await r.json()
      const quotes = json?.finance?.result?.[0]?.quotes ?? []
      return quotes.map((q: any) => ({
        symbol: q.symbol,
        shortName: q.shortName ?? q.symbol,
        regularMarketPrice: q.regularMarketPrice ?? 0,
        regularMarketChangePercent: q.regularMarketChangePercent ?? 0,
        regularMarketVolume: q.regularMarketVolume ?? 0,
      }))
    } catch {
      return []
    }
  })

// ─── Day-trade recommendation types ──────────────────────────────────────────

export type DayTradeRec = {
  symbol: string
  shortName: string
  price: number
  changePercent: number
  volume: number
  avgVolume: number
  volumeSurge: number   // volume / avgVolume
  intradayRange: number // (high - low) / low  %
  entry: number
  target: number        // entry + 2–5% depending on momentum
  stop: number          // entry - ~1%
  score: number         // 0–100 composite
  signals: string[]     // human-readable reasons
}

// ─── getDayTradeRecs ──────────────────────────────────────────────────────────

export const getDayTradeRecs = createServerFn({ method: 'GET' })
  .handler(async () => {
    try {
      // Pull top gainers + most active — union gives the broadest candidate pool
      const [gainersRes, activeRes] = await Promise.allSettled([
        fetchWithTimeout(
          'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=day_gainers&count=25',
          { headers: { 'User-Agent': 'Mozilla/5.0' } },
        ),
        fetchWithTimeout(
          'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=most_actives&count=25',
          { headers: { 'User-Agent': 'Mozilla/5.0' } },
        ),
      ])

      const raw: any[] = []
      for (const res of [gainersRes, activeRes]) {
        if (res.status === 'fulfilled' && res.value.ok) {
          const json = await res.value.json()
          const quotes: any[] = json?.finance?.result?.[0]?.quotes ?? []
          for (const q of quotes) {
            if (!raw.find((r) => r.symbol === q.symbol)) raw.push(q)
          }
        }
      }

      // ── Filter: only liquid, mid-to-large cap day-tradeable candidates ──────
      const candidates = raw.filter((q) => {
        const price: number = q.regularMarketPrice ?? 0
        const volume: number = q.regularMarketVolume ?? 0
        const avgVolume: number = q.averageDailyVolume3Month ?? q.averageDailyVolume10Day ?? 0
        const pct: number = q.regularMarketChangePercent ?? 0
        const high: number = q.regularMarketDayHigh ?? 0
        const low: number = q.regularMarketDayLow ?? 0
        const range = low > 0 ? ((high - low) / low) * 100 : 0

        return (
          price >= 5 &&           // not a penny stock
          price <= 2000 &&        // not a micro-float high-price outlier
          volume >= 500_000 &&    // enough liquidity to enter/exit cleanly
          pct >= 1 &&             // already showing upside momentum
          pct <= 15 &&            // not parabolic / halt-risk
          range >= 1 &&           // enough intraday range to trade
          (avgVolume === 0 || volume / avgVolume >= 1.2) // volume confirmation
        )
      })

      // ── Score each candidate (0–100) ─────────────────────────────────────────
      const scored: DayTradeRec[] = candidates.map((q) => {
        const price: number = q.regularMarketPrice ?? 0
        const pct: number = q.regularMarketChangePercent ?? 0
        const volume: number = q.regularMarketVolume ?? 0
        const avgVolume: number = q.averageDailyVolume3Month ?? q.averageDailyVolume10Day ?? volume
        const high: number = q.regularMarketDayHigh ?? price
        const low: number = q.regularMarketDayLow ?? price
        const open: number = q.regularMarketOpen ?? price

        const volumeSurge = avgVolume > 0 ? volume / avgVolume : 1
        const intradayRange = low > 0 ? ((high - low) / low) * 100 : 0

        const signals: string[] = []

        // Volume surge score (0–35): higher volume = stronger conviction
        const volScore = Math.min(35, (volumeSurge - 1) * 10)
        if (volumeSurge >= 3) signals.push(`${volumeSurge.toFixed(1)}× avg volume`)
        else if (volumeSurge >= 1.5) signals.push(`${volumeSurge.toFixed(1)}× avg volume`)

        // Momentum score (0–30): sweet spot 2–8% — enough to enter, not overextended
        const momScore = pct >= 2 && pct <= 8
          ? 30
          : pct > 8
          ? Math.max(0, 30 - (pct - 8) * 3)
          : pct * 10
        if (pct >= 2) signals.push(`+${pct.toFixed(1)}% day gain`)

        // Price vs open (0–20): above open is bullish intraday structure
        const aboveOpen = price > open
        const openScore = aboveOpen ? 20 : 5
        if (aboveOpen) signals.push('trading above open')

        // Range score (0–15): wider range = more opportunity
        const rangeScore = Math.min(15, intradayRange * 2)
        if (intradayRange >= 3) signals.push(`${intradayRange.toFixed(1)}% intraday range`)

        const score = Math.round(volScore + momScore + openScore + rangeScore)

        // ── Entry / target / stop ─────────────────────────────────────────────
        // Entry: current price (market order near ask)
        // Target: 2% base + up to 3% bonus proportional to score
        // Stop: 1% below entry (tight stop for day trade)
        const entry = price
        const targetPct = 0.02 + (score / 100) * 0.03  // 2%–5% range
        const target = parseFloat((entry * (1 + targetPct)).toFixed(2))
        const stop = parseFloat((entry * 0.99).toFixed(2))

        return {
          symbol: q.symbol,
          shortName: q.shortName ?? q.symbol,
          price,
          changePercent: pct,
          volume,
          avgVolume,
          volumeSurge,
          intradayRange,
          entry,
          target,
          stop,
          score,
          signals,
        }
      })

      // Sort by score desc, return top 8
      return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
    } catch {
      return []
    }
  })
