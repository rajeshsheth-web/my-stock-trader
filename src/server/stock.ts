import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const SYMBOL_RE = /^[A-Z0-9.\-^]{1,12}$/

const YF1 = 'https://query1.finance.yahoo.com'
const YF2 = 'https://query2.finance.yahoo.com'

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

// Fetch quote via v7 — returns pre/post market fields reliably
async function fetchV7Quote(symbol: string) {
  const fields = [
    'regularMarketPrice', 'regularMarketChange', 'regularMarketChangePercent',
    'regularMarketVolume', 'regularMarketOpen', 'regularMarketDayHigh', 'regularMarketDayLow',
    'regularMarketPreviousClose', 'regularMarketTime',
    'shortName', 'longName', 'currency', 'fullExchangeName', 'exchange',
    'fiftyTwoWeekHigh', 'fiftyTwoWeekLow', 'marketCap',
    'marketState',
    'preMarketPrice', 'preMarketChange', 'preMarketChangePercent', 'preMarketTime',
    'postMarketPrice', 'postMarketChange', 'postMarketChangePercent', 'postMarketTime',
  ].join(',')
  const json = await yfFetch(
    `${YF2}/v7/finance/quote?symbols=${encodeURIComponent(symbol)}&fields=${fields}&formatted=false`
  )
  return json?.quoteResponse?.result?.[0] ?? null
}

// ─── getStockOverview ─────────────────────────────────────────────────────────

export const getStockOverview = createServerFn({ method: 'GET' })
  .inputValidator((s: unknown) => z.string().regex(SYMBOL_RE).parse(s))
  .handler(async ({ data: symbol }) => {
    try {
      const q = await fetchV7Quote(symbol)
      if (!q || !q.regularMarketPrice) return null

      const price: number = q.regularMarketPrice
      const prevClose: number = q.regularMarketPreviousClose ?? price
      const change: number = q.regularMarketChange ?? price - prevClose
      const changePct: number = q.regularMarketChangePercent ?? 0
      const ms: string = q.marketState ?? 'CLOSED'

      return {
        symbol,
        shortName: q.shortName ?? q.longName ?? symbol,
        regularMarketPrice: price,
        regularMarketChange: change,
        regularMarketChangePercent: changePct,
        regularMarketVolume: q.regularMarketVolume ?? 0,
        regularMarketOpen: q.regularMarketOpen ?? 0,
        regularMarketDayHigh: q.regularMarketDayHigh ?? 0,
        regularMarketDayLow: q.regularMarketDayLow ?? 0,
        fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? 0,
        fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? 0,
        marketCap: q.marketCap ?? 0,
        currency: q.currency ?? 'USD',
        exchangeName: q.fullExchangeName ?? q.exchange ?? '',
        previousClose: prevClose,
        isMarketOpen: ms === 'REGULAR',
        marketState: ms,
        preMarketPrice: q.preMarketPrice ?? null,
        preMarketChange: q.preMarketChange ?? null,
        preMarketChangePercent: q.preMarketChangePercent ?? null,
        postMarketPrice: q.postMarketPrice ?? null,
        postMarketChange: q.postMarketChange ?? null,
        postMarketChangePercent: q.postMarketChangePercent ?? null,
      }
    } catch {
      return null
    }
  })

// ─── getStockQuote ────────────────────────────────────────────────────────────

export const getStockQuote = createServerFn({ method: 'GET' })
  .inputValidator((s: unknown) => z.string().regex(SYMBOL_RE).parse(s))
  .handler(async ({ data: symbol }) => {
    try {
      const q = await fetchV7Quote(symbol)
      if (!q || !q.regularMarketPrice) return null

      const price: number = q.regularMarketPrice
      const prevClose: number = q.regularMarketPreviousClose ?? price
      const change: number = q.regularMarketChange ?? price - prevClose
      const changePct: number = q.regularMarketChangePercent ?? 0
      const ms: string = q.marketState ?? 'CLOSED'

      return {
        price,
        change,
        changePct,
        high: q.regularMarketDayHigh ?? 0,
        low: q.regularMarketDayLow ?? 0,
        open: q.regularMarketOpen ?? 0,
        prevClose,
        timestamp: q.regularMarketTime ?? Math.floor(Date.now() / 1000),
        marketState: ms,
        preMarketPrice: q.preMarketPrice ?? null,
        preMarketChange: q.preMarketChange ?? null,
        preMarketChangePercent: q.preMarketChangePercent ?? null,
        postMarketPrice: q.postMarketPrice ?? null,
        postMarketChange: q.postMarketChange ?? null,
        postMarketChangePercent: q.postMarketChangePercent ?? null,
      }
    } catch {
      return null
    }
  })

// ─── getRangeCandles ──────────────────────────────────────────────────────────

export const getRangeCandles = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) =>
    z.object({
      symbol: z.string().regex(SYMBOL_RE),
      range: z.string(),
      interval: z.string(),
    }).parse(d)
  )
  .handler(async ({ data: { symbol, range, interval } }) => {
    try {
      const json = await yfFetch(
        `${YF1}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=true`
      )
      const result = json?.chart?.result?.[0]
      if (!result) return []
      const ts: number[] = result.timestamp ?? []
      const ohlcv = result.indicators?.quote?.[0] ?? {}

      return ts
        .map((t: number, i: number) => ({
          time: t,
          open: ohlcv.open?.[i] ?? 0,
          high: ohlcv.high?.[i] ?? 0,
          low: ohlcv.low?.[i] ?? 0,
          close: ohlcv.close?.[i] ?? 0,
          volume: ohlcv.volume?.[i] ?? 0,
        }))
        .filter((c: { close: number }) => c.close != null && c.close > 0)
    } catch {
      return []
    }
  })
