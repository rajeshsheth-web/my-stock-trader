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

function extractExtendedHours(meta: any, ts: number[], closes: (number | null)[]) {
  const ms: string = meta?.marketState ?? 'REGULAR'
  if (ms === 'REGULAR') return null

  if (!ts.length) return null

  const isPreMarket = ms === 'PRE' || ms === 'PREPRE'
  const ctp = meta?.currentTradingPeriod ?? {}
  const regularEnd: number = ctp.regular?.end ?? 0
  const regularStart: number = ctp.regular?.start ?? 0
  const regularMarketTime: number = meta?.regularMarketTime ?? 0

  const boundary = isPreMarket
    ? (regularStart > 0 ? regularStart : 0)
    : (regularEnd > 0 ? regularEnd : regularMarketTime)

  if (boundary === 0) return null

  const pairs = ts.map((t, i) => ({ t, c: closes[i] }))
  const regCandles = pairs.filter(({ t, c }) => c != null && (c as number) > 0 && t <= boundary)
  const extCandles = pairs.filter(({ t, c }) => c != null && (c as number) > 0 && (isPreMarket ? t < boundary : t > boundary))

  const extPrice = extCandles.length ? extCandles[extCandles.length - 1].c as number : null
  if (extPrice == null) return null

  // Use last regular-session candle as reference — meta.regularMarketPrice may
  // already reflect after-hours on Yahoo Finance.
  const regularClose = regCandles.length ? regCandles[regCandles.length - 1].c as number : null
  if (regularClose == null) return null

  const extChange = extPrice - regularClose
  const extChangePct = regularClose > 0 ? (extChange / regularClose) * 100 : 0

  return {
    preMarketPrice: isPreMarket ? extPrice : null,
    preMarketChange: isPreMarket ? extChange : null,
    preMarketChangePercent: isPreMarket ? extChangePct : null,
    postMarketPrice: !isPreMarket ? extPrice : null,
    postMarketChange: !isPreMarket ? extChange : null,
    postMarketChangePercent: !isPreMarket ? extChangePct : null,
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
      const ts: number[] = result.timestamp ?? []
      const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? []
      const ext = extractExtendedHours(meta, ts, closes)

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
        _d: `ms=${ms} post=${ext?.postMarketPrice ?? 'null'}`,
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
      const ts: number[] = result.timestamp ?? []
      const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? []
      const ext = extractExtendedHours(meta, ts, closes)

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
