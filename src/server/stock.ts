import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const SYMBOL_RE = /^[A-Z0-9.\-^]{1,12}$/
const BASE = 'https://finnhub.io/api/v1'

function token() {
  const k = process.env.FINNHUB_API_KEY
  if (!k) throw new Error('FINNHUB_API_KEY not set')
  return k
}

async function fetchWithTimeout(url: string, ms = 4500) {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'X-Finnhub-Token': token() },
    })
    return r
  } finally {
    clearTimeout(id)
  }
}

// ─── getStockOverview ─────────────────────────────────────────────────────────
// Returns live quote + company profile merged into one object.
// Extended-hours price is included in the quote (Finnhub returns current price
// regardless of session).

export const getStockOverview = createServerFn({ method: 'GET' })
  .inputValidator((s: unknown) => {
    return z.string().regex(SYMBOL_RE).parse(s)
  })
  .handler(async ({ data: symbol }) => {
    try {
      const [quoteRes, profileRes] = await Promise.allSettled([
        fetchWithTimeout(`${BASE}/quote?symbol=${symbol}`),
        fetchWithTimeout(`${BASE}/stock/profile2?symbol=${symbol}`),
      ])

      if (quoteRes.status === 'rejected' || !quoteRes.value.ok) return null
      const q = await quoteRes.value.json()
      if (!q.c || q.c === 0) return null  // symbol not found / market closed with no data

      let profile: Record<string, unknown> = {}
      if (profileRes.status === 'fulfilled' && profileRes.value.ok) {
        profile = await profileRes.value.json()
      }

      const price: number = q.c      // current price
      const prevClose: number = q.pc // previous close
      const change = price - prevClose
      const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0

      return {
        symbol,
        shortName: (profile.name as string) ?? symbol,
        regularMarketPrice: price,
        regularMarketChange: change,
        regularMarketChangePercent: changePct,
        regularMarketVolume: 0,        // not in Finnhub quote endpoint
        regularMarketOpen: q.o ?? 0,
        regularMarketDayHigh: q.h ?? 0,
        regularMarketDayLow: q.l ?? 0,
        fiftyTwoWeekHigh: (profile.weekHigh52 as number) ?? 0,
        fiftyTwoWeekLow: (profile.weekLow52 as number) ?? 0,
        marketCap: (profile.marketCapitalization as number)
          ? (profile.marketCapitalization as number) * 1_000_000
          : 0,
        currency: (profile.currency as string) ?? 'USD',
        exchangeName: (profile.exchange as string) ?? '',
        previousClose: prevClose,
        // Extended-hours fields (Finnhub returns real-time price in extended hours too)
        isMarketOpen: false, // will be set below
      }
    } catch {
      return null
    }
  })

// ─── getStockQuote ────────────────────────────────────────────────────────────
// Lightweight poll-only endpoint for the 10-second QuoteHeader refresh.

export const getStockQuote = createServerFn({ method: 'GET' })
  .inputValidator((s: unknown) => z.string().regex(SYMBOL_RE).parse(s))
  .handler(async ({ data: symbol }) => {
    try {
      const r = await fetchWithTimeout(`${BASE}/quote?symbol=${symbol}`)
      if (!r.ok) return null
      const q = await r.json()
      if (!q.c || q.c === 0) return null
      const price: number = q.c
      const prevClose: number = q.pc
      const change = price - prevClose
      const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0
      return {
        price,
        change,
        changePct,
        high: q.h ?? 0,
        low: q.l ?? 0,
        open: q.o ?? 0,
        prevClose,
        timestamp: q.t ?? 0,
      }
    } catch {
      return null
    }
  })

// ─── getRangeCandles ──────────────────────────────────────────────────────────
// Finnhub resolution mapping:
//   1D  → resolution 5  (5-min), from = today market open
//   5D  → resolution 15 (15-min), from = 5 days ago
//   1M  → resolution D,  from = 30 days ago
//   6M  → resolution D,  from = 180 days ago
//   YTD → resolution D,  from = Jan 1 this year
//   1Y  → resolution W,  from = 365 days ago
//   5Y  → resolution W,  from = 5 years ago
//   Max → resolution M,  from = 20 years ago

export const getRangeCandles = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) =>
    z.object({
      symbol: z.string().regex(SYMBOL_RE),
      range: z.string(),
      interval: z.string(),
    }).parse(d)
  )
  .handler(async ({ data: { symbol, range } }) => {
    try {
      const now = Math.floor(Date.now() / 1000)
      const dayStart = (() => {
        const d = new Date()
        d.setHours(9, 30, 0, 0)  // NYSE open
        return Math.floor(d.getTime() / 1000)
      })()

      type RangeMap = { resolution: string; from: number }
      const map: Record<string, RangeMap> = {
        '1d':  { resolution: '5',  from: dayStart },
        '5d':  { resolution: '15', from: now - 5 * 24 * 3600 },
        '1mo': { resolution: 'D',  from: now - 30 * 24 * 3600 },
        '6mo': { resolution: 'D',  from: now - 180 * 24 * 3600 },
        'ytd': { resolution: 'D',  from: Math.floor(new Date(new Date().getFullYear(), 0, 1).getTime() / 1000) },
        '1y':  { resolution: 'W',  from: now - 365 * 24 * 3600 },
        '5y':  { resolution: 'W',  from: now - 5 * 365 * 24 * 3600 },
        'max': { resolution: 'M',  from: now - 20 * 365 * 24 * 3600 },
      }

      const cfg = map[range] ?? map['1d']
      const url = `${BASE}/stock/candle?symbol=${symbol}&resolution=${cfg.resolution}&from=${cfg.from}&to=${now}`
      const r = await fetchWithTimeout(url)
      if (!r.ok) return []
      const json = await r.json()
      if (json.s !== 'ok' || !json.t) return []

      const ts: number[] = json.t
      return ts.map((t: number, i: number) => ({
        time: t,
        open: json.o[i] ?? 0,
        high: json.h[i] ?? 0,
        low: json.l[i] ?? 0,
        close: json.c[i] ?? 0,
        volume: json.v[i] ?? 0,
      })).filter((c: { close: number }) => c.close > 0)
    } catch {
      return []
    }
  })
