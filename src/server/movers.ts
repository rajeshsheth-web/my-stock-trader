import { createServerFn } from '@tanstack/react-start'

const YF_BASE = 'https://query1.finance.yahoo.com'

async function yfFetch(url: string) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(5000),
  })
  if (!r.ok) throw new Error(`YF HTTP ${r.status}`)
  return r.json()
}

async function fetchScreener(scrId: string, count = 25): Promise<any[]> {
  const json = await yfFetch(
    `${YF_BASE}/v1/finance/screener/predefined/saved?formatted=false&scrIds=${scrId}&count=${count}`
  )
  return json?.finance?.result?.[0]?.quotes ?? []
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
      const quotes = await fetchScreener(scrIds[category], 20)
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
  volumeSurge: number
  intradayRange: number
  entry: number
  target: number
  stop: number
  score: number
  signals: string[]
}

// ─── getDayTradeRecs ──────────────────────────────────────────────────────────

export const getDayTradeRecs = createServerFn({ method: 'GET' })
  .handler(async () => {
    try {
      const [gainers, active] = await Promise.allSettled([
        fetchScreener('day_gainers', 25),
        fetchScreener('most_actives', 25),
      ])

      const raw: any[] = []
      for (const res of [gainers, active]) {
        if (res.status === 'fulfilled') {
          for (const q of res.value) {
            if (!raw.find((r) => r.symbol === q.symbol)) raw.push(q)
          }
        }
      }

      const candidates = raw.filter((q) => {
        const price: number = q.regularMarketPrice ?? 0
        const volume: number = q.regularMarketVolume ?? 0
        const avgVolume: number = q.averageDailyVolume3Month ?? q.averageDailyVolume10Day ?? 0
        const pct: number = q.regularMarketChangePercent ?? 0
        const high: number = q.regularMarketDayHigh ?? 0
        const low: number = q.regularMarketDayLow ?? 0
        const range = low > 0 ? ((high - low) / low) * 100 : 0
        return (
          price >= 5 && price <= 2000 &&
          volume >= 500_000 &&
          pct >= 1 && pct <= 15 &&
          range >= 1 &&
          (avgVolume === 0 || volume / avgVolume >= 1.2)
        )
      })

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

        const volScore = Math.min(35, (volumeSurge - 1) * 10)
        if (volumeSurge >= 1.5) signals.push(`${volumeSurge.toFixed(1)}× avg volume`)

        const momScore = pct >= 2 && pct <= 8 ? 30 : pct > 8 ? Math.max(0, 30 - (pct - 8) * 3) : pct * 10
        if (pct >= 2) signals.push(`+${pct.toFixed(1)}% day gain`)

        const aboveOpen = price > open
        const openScore = aboveOpen ? 20 : 5
        if (aboveOpen) signals.push('trading above open')

        const rangeScore = Math.min(15, intradayRange * 2)
        if (intradayRange >= 3) signals.push(`${intradayRange.toFixed(1)}% intraday range`)

        const score = Math.round(volScore + momScore + openScore + rangeScore)
        const entry = price
        const targetPct = 0.02 + (score / 100) * 0.03
        const target = parseFloat((entry * (1 + targetPct)).toFixed(2))
        const stop = parseFloat((entry * 0.99).toFixed(2))

        return {
          symbol: q.symbol,
          shortName: q.shortName ?? q.symbol,
          price, changePercent: pct, volume, avgVolume,
          volumeSurge, intradayRange, entry, target, stop, score, signals,
        }
      })

      return scored.sort((a, b) => b.score - a.score).slice(0, 8)
    } catch {
      return []
    }
  })
