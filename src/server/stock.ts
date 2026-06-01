import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const SYMBOL_RE = /^[A-Z0-9.\-^]{1,12}$/

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

// ─── getStockOverview ─────────────────────────────────────────────────────────

export const getStockOverview = createServerFn({ method: 'GET' })
  .inputValidator((s: unknown) => z.string().regex(SYMBOL_RE).parse(s))
  .handler(async ({ data: symbol }) => {
    try {
      const json = await yfFetch(
        `${YF_BASE}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d&includePrePost=true`
      )
      const meta = json?.chart?.result?.[0]?.meta
      if (!meta || !meta.regularMarketPrice) return null

      const price: number = meta.regularMarketPrice
      const prevClose: number = meta.chartPreviousClose ?? meta.previousClose ?? price
      const change = price - prevClose
      const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0

      const ms: string = meta.marketState ?? 'CLOSED'

      return {
        symbol,
        shortName: meta.shortName ?? meta.longName ?? symbol,
        regularMarketPrice: price,
        regularMarketChange: change,
        regularMarketChangePercent: changePct,
        regularMarketVolume: meta.regularMarketVolume ?? 0,
        regularMarketOpen: meta.regularMarketOpen ?? 0,
        regularMarketDayHigh: meta.regularMarketDayHigh ?? 0,
        regularMarketDayLow: meta.regularMarketDayLow ?? 0,
        fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? 0,
        fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? 0,
        marketCap: 0,
        currency: meta.currency ?? 'USD',
        exchangeName: meta.fullExchangeName ?? meta.exchangeName ?? '',
        previousClose: prevClose,
        isMarketOpen: ms === 'REGULAR',
        marketState: ms,
        preMarketPrice: meta.preMarketPrice ?? null,
        preMarketChange: meta.preMarketChange ?? null,
        preMarketChangePercent: meta.preMarketChangePercent ?? null,
        postMarketPrice: meta.postMarketPrice ?? null,
        postMarketChange: meta.postMarketChange ?? null,
        postMarketChangePercent: meta.postMarketChangePercent ?? null,
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
      const json = await yfFetch(
        `${YF_BASE}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d&includePrePost=true`
      )
      const meta = json?.chart?.result?.[0]?.meta
      if (!meta || !meta.regularMarketPrice) return null

      const price: number = meta.regularMarketPrice
      const prevClose: number = meta.chartPreviousClose ?? meta.previousClose ?? price
      const change = price - prevClose
      const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0
      const ms: string = meta.marketState ?? 'CLOSED'

      return {
        price,
        change,
        changePct,
        high: meta.regularMarketDayHigh ?? 0,
        low: meta.regularMarketDayLow ?? 0,
        open: meta.regularMarketOpen ?? 0,
        prevClose,
        timestamp: meta.regularMarketTime ?? Math.floor(Date.now() / 1000),
        marketState: ms,
        preMarketPrice: meta.preMarketPrice ?? null,
        preMarketChange: meta.preMarketChange ?? null,
        preMarketChangePercent: meta.preMarketChangePercent ?? null,
        postMarketPrice: meta.postMarketPrice ?? null,
        postMarketChange: meta.postMarketChange ?? null,
        postMarketChangePercent: meta.postMarketChangePercent ?? null,
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
        `${YF_BASE}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=true`
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
