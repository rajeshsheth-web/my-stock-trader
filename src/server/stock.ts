import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import yahooFinance from 'yahoo-finance2'

const SYMBOL_RE = /^[A-Z0-9.\-^]{1,12}$/

// ─── getStockOverview ─────────────────────────────────────────────────────────

export const getStockOverview = createServerFn({ method: 'GET' })
  .inputValidator((s: unknown) => z.string().regex(SYMBOL_RE).parse(s))
  .handler(async ({ data: symbol }) => {
    try {
      const [quote, summary] = await Promise.allSettled([
        yahooFinance.quote(symbol),
        yahooFinance.quoteSummary(symbol, { modules: ['summaryDetail', 'price'] }),
      ])

      if (quote.status === 'rejected') return null
      const q = quote.value
      if (!q || !q.regularMarketPrice) return null

      const price = q.regularMarketPrice ?? 0
      const sd = summary.status === 'fulfilled' ? summary.value?.summaryDetail : null

      return {
        symbol,
        shortName: q.shortName ?? q.longName ?? symbol,
        regularMarketPrice: price,
        regularMarketChange: q.regularMarketChange ?? 0,
        regularMarketChangePercent: q.regularMarketChangePercent ?? 0,
        regularMarketVolume: q.regularMarketVolume ?? 0,
        regularMarketOpen: q.regularMarketOpen ?? 0,
        regularMarketDayHigh: q.regularMarketDayHigh ?? 0,
        regularMarketDayLow: q.regularMarketDayLow ?? 0,
        fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? 0,
        fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? 0,
        marketCap: q.marketCap ?? 0,
        currency: q.currency ?? 'USD',
        exchangeName: q.fullExchangeName ?? q.exchange ?? '',
        previousClose: q.regularMarketPreviousClose ?? 0,
        isMarketOpen: q.marketState === 'REGULAR',
        // Extended-hours fields
        preMarketPrice: q.preMarketPrice ?? null,
        preMarketChange: q.preMarketChange ?? null,
        preMarketChangePercent: q.preMarketChangePercent ?? null,
        postMarketPrice: q.postMarketPrice ?? null,
        postMarketChange: q.postMarketChange ?? null,
        postMarketChangePercent: q.postMarketChangePercent ?? null,
        marketState: q.marketState ?? 'CLOSED',
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
      const q = await yahooFinance.quote(symbol)
      if (!q || !q.regularMarketPrice) return null
      const price = q.regularMarketPrice ?? 0
      const prevClose = q.regularMarketPreviousClose ?? 0
      const change = q.regularMarketChange ?? price - prevClose
      const changePct = q.regularMarketChangePercent ?? 0
      return {
        price,
        change,
        changePct,
        high: q.regularMarketDayHigh ?? 0,
        low: q.regularMarketDayLow ?? 0,
        open: q.regularMarketOpen ?? 0,
        prevClose,
        timestamp: q.regularMarketTime ? Math.floor(new Date(q.regularMarketTime).getTime() / 1000) : Math.floor(Date.now() / 1000),
        marketState: q.marketState ?? 'CLOSED',
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
      const validInterval = interval as '1m' | '2m' | '5m' | '15m' | '30m' | '60m' | '90m' | '1h' | '1d' | '5d' | '1wk' | '1mo' | '3mo'
      const validRange = range as '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y' | '10y' | 'ytd' | 'max'

      const result = await yahooFinance.chart(symbol, {
        interval: validInterval,
        range: validRange,
        includePrePost: true,
      })

      if (!result?.quotes?.length) return []

      return result.quotes
        .filter(c => c.close != null && c.close > 0)
        .map(c => ({
          time: Math.floor(new Date(c.date).getTime() / 1000),
          open: c.open ?? 0,
          high: c.high ?? 0,
          low: c.low ?? 0,
          close: c.close ?? 0,
          volume: c.volume ?? 0,
        }))
    } catch {
      return []
    }
  })
