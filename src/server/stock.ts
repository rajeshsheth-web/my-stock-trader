import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const SYMBOL_RE = /^[A-Z0-9.\-^]{1,12}$/

// Cookie+crumb cache (module-level, ~30 min TTL)
let yfCookie = ''
let yfCrumb = ''
let crumbExpiry = 0

async function fetchWithTimeout(url: string, opts: RequestInit = {}, ms = 4500) {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), ms)
  try { return await fetch(url, { ...opts, signal: ctrl.signal }) }
  finally { clearTimeout(id) }
}

async function getYFCrumb() {
  if (yfCrumb && Date.now() < crumbExpiry) return { cookie: yfCookie, crumb: yfCrumb }
  const r1 = await fetchWithTimeout('https://finance.yahoo.com/', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  })
  const cookieHeader = r1.headers.get('set-cookie') ?? ''
  yfCookie = cookieHeader.split(';')[0]
  const r2 = await fetchWithTimeout('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': 'Mozilla/5.0', Cookie: yfCookie }
  })
  yfCrumb = await r2.text()
  crumbExpiry = Date.now() + 30 * 60 * 1000
  return { cookie: yfCookie, crumb: yfCrumb }
}

export const getStockOverview = createServerFn({ method: 'GET' })
  .inputValidator((s: unknown) => {
    const sym = z.string().regex(SYMBOL_RE).parse(s)
    return sym
  })
  .handler(async ({ data: symbol }) => {
    try {
      const { cookie, crumb } = await getYFCrumb()
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=5m&crumb=${crumb}`
      const r = await fetchWithTimeout(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Cookie: cookie }
      })
      if (!r.ok) return null
      const json = await r.json()
      const meta = json?.chart?.result?.[0]?.meta
      if (!meta) return null
      return {
        symbol: meta.symbol,
        shortName: meta.shortName ?? meta.symbol,
        regularMarketPrice: meta.regularMarketPrice ?? 0,
        regularMarketChange: meta.regularMarketChange ?? 0,
        regularMarketChangePercent: meta.regularMarketChangePercent ?? 0,
        regularMarketVolume: meta.regularMarketVolume ?? 0,
        regularMarketOpen: meta.regularMarketOpen ?? 0,
        regularMarketDayHigh: meta.regularMarketDayHigh ?? 0,
        regularMarketDayLow: meta.regularMarketDayLow ?? 0,
        fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? 0,
        fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? 0,
        marketCap: meta.marketCap ?? 0,
        currency: meta.currency ?? 'USD',
        exchangeName: meta.exchangeName ?? '',
        previousClose: meta.previousClose ?? meta.chartPreviousClose ?? 0,
      }
    } catch {
      return null
    }
  })

export const getRangeCandles = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => z.object({
    symbol: z.string().regex(SYMBOL_RE),
    range: z.string(),
    interval: z.string(),
  }).parse(d))
  .handler(async ({ data: { symbol, range, interval } }) => {
    try {
      const { cookie, crumb } = await getYFCrumb()
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}&crumb=${crumb}`
      const r = await fetchWithTimeout(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Cookie: cookie }
      })
      if (!r.ok) return []
      const json = await r.json()
      const result = json?.chart?.result?.[0]
      if (!result) return []
      const ts: number[] = result.timestamp ?? []
      const q = result.indicators?.quote?.[0] ?? {}
      return ts.map((t: number, i: number) => ({
        time: t,
        open: q.open?.[i] ?? 0,
        high: q.high?.[i] ?? 0,
        low: q.low?.[i] ?? 0,
        close: q.close?.[i] ?? 0,
        volume: q.volume?.[i] ?? 0,
      })).filter(c => c.close > 0)
    } catch {
      return []
    }
  })
