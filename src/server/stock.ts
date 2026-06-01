import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const SYMBOL_RE = /^[A-Z0-9.\-^]{1,12}$/
const YF1 = 'https://query1.finance.yahoo.com'

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

// v8 chart endpoint — reliable, returns OHLCV + meta with marketState
async function fetchChart(symbol: string, range = '1d', interval = '1d') {
  const json = await yfFetch(
    `${YF1}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=true`
  )
  return json?.chart?.result?.[0] ?? null
}

// Extract extended hours price from the v8 chart result's candle data.
function extractExtendedHours(result: any, regularPrice: number) {
  try {
    const ms: string = result.meta?.marketState ?? 'REGULAR'
    if (ms === 'REGULAR') return null

    const ts: number[] = result.timestamp ?? []
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? []
    if (!ts.length) return null

    const isPreMarket = ms === 'PRE' || ms === 'PREPRE'

    // Use the most recent regular session boundary
    const regularEnd: number = result.meta?.currentTradingPeriod?.regular?.end ?? 0
    const regularStart: number = result.meta?.currentTradingPeriod?.regular?.start ?? 0
    // Fallback: use regularMarketTime (last regular close timestamp) when boundary is unavailable
    const regularMarketTime: number = result.meta?.regularMarketTime ?? 0

    const boundary = isPreMarket
      ? (regularStart > 0 ? regularStart : 0)
      : (regularEnd > 0 ? regularEnd : regularMarketTime)

    let extPrice: number | null = null

    if (boundary > 0) {
      const extCandles = ts
        .map((t, i) => ({ t, c: closes[i] }))
        .filter(({ t, c }) => c != null && c > 0 && (isPreMarket ? t < boundary : t > boundary))
      if (extCandles.length) extPrice = extCandles[extCandles.length - 1].c
    }


    if (extPrice == null || Math.abs(extPrice - regularPrice) < 0.001) return null

    const extChange = extPrice - regularPrice
    const extChangePct = regularPrice > 0 ? (extChange / regularPrice) * 100 : 0

    return {
      marketState: ms,
      preMarketPrice: isPreMarket ? extPrice : null,
      preMarketChange: isPreMarket ? extChange : null,
      preMarketChangePercent: isPreMarket ? extChangePct : null,
      postMarketPrice: !isPreMarket ? extPrice : null,
      postMarketChange: !isPreMarket ? extChange : null,
      postMarketChangePercent: !isPreMarket ? extChangePct : null,
    }
  } catch {
    return null
  }
}

// ─── getStockOverview ─────────────────────────────────────────────────────────

export const getStockOverview = createServerFn({ method: 'GET' })
  .inputValidator((s: unknown) => z.string().regex(SYMBOL_RE).parse(s))
  .handler(async ({ data: symbol }) => {
    try {
      const result = await fetchChart(symbol, '5d', '15m')
      if (!result) return null
      const meta = result.meta
      if (!meta?.regularMarketPrice) return null

      const price: number = meta.regularMarketPrice
      const prevClose: number = meta.chartPreviousClose ?? meta.previousClose ?? price
      const change = price - prevClose
      const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0
      const ms: string = meta.marketState ?? 'CLOSED'
      const ext = extractExtendedHours(result, price)

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
        preMarketPrice: ext?.preMarketPrice ?? null,
        preMarketChange: ext?.preMarketChange ?? null,
        preMarketChangePercent: ext?.preMarketChangePercent ?? null,
        postMarketPrice: ext?.postMarketPrice ?? null,
        postMarketChange: ext?.postMarketChange ?? null,
        postMarketChangePercent: ext?.postMarketChangePercent ?? null,
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
      const result = await fetchChart(symbol, '5d', '15m')
      if (!result) return null
      const meta = result.meta
      if (!meta?.regularMarketPrice) return null

      const price: number = meta.regularMarketPrice
      const prevClose: number = meta.chartPreviousClose ?? meta.previousClose ?? price
      const change = price - prevClose
      const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0
      const ms: string = meta.marketState ?? 'CLOSED'
      const ext = extractExtendedHours(result, price)

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
        preMarketPrice: ext?.preMarketPrice ?? null,
        preMarketChange: ext?.preMarketChange ?? null,
        preMarketChangePercent: ext?.preMarketChangePercent ?? null,
        postMarketPrice: ext?.postMarketPrice ?? null,
        postMarketChange: ext?.postMarketChange ?? null,
        postMarketChangePercent: ext?.postMarketChangePercent ?? null,
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
      const result = await fetchChart(symbol, range, interval)
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
