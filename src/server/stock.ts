import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const SYMBOL_RE = /^[A-Z0-9.\-^]{1,12}$/
const YF1 = 'https://query1.finance.yahoo.com'
const YF2 = 'https://query2.finance.yahoo.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

async function yfFetch(url: string) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(5000),
  })
  if (!r.ok) throw new Error(`YF HTTP ${r.status}`)
  return r.json()
}

// Yahoo Finance v10 requires a crumb+cookie pair obtained via a handshake.
// Cache in module scope — stays warm between Vercel invocations.
let _crumbCache: { crumb: string; cookie: string; expiresAt: number } | null = null

async function getYahooCrumb() {
  if (_crumbCache && _crumbCache.expiresAt > Date.now()) return _crumbCache

  // Step 1: hit the consent page to get a session cookie
  const consentRes = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA, 'Accept': '*/*' },
    signal: AbortSignal.timeout(8000),
    redirect: 'follow',
  })
  // Collect all Set-Cookie values
  const rawCookies: string[] = []
  consentRes.headers.forEach((val, key) => {
    if (key.toLowerCase() === 'set-cookie') rawCookies.push(val.split(';')[0])
  })
  const cookieStr = rawCookies.join('; ')

  // Step 2: exchange the cookie for a crumb
  const crumbRes = await fetch(`${YF2}/v1/test/getcrumb`, {
    headers: { 'User-Agent': UA, 'Cookie': cookieStr, 'Accept': 'text/plain' },
    signal: AbortSignal.timeout(6000),
  })
  const crumb = (await crumbRes.text()).trim()
  if (!crumb || crumb.length > 40 || crumb.startsWith('<'))
    throw new Error('Bad crumb: ' + crumb.slice(0, 60))

  _crumbCache = { crumb, cookie: cookieStr, expiresAt: Date.now() + 55 * 60_000 }
  return _crumbCache
}

async function yfFetchAuthed(path: string) {
  const { crumb, cookie } = await getYahooCrumb()
  const sep = path.includes('?') ? '&' : '?'
  const r = await fetch(`${YF2}${path}${sep}crumb=${encodeURIComponent(crumb)}`, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Cookie': cookie },
    signal: AbortSignal.timeout(10000),
  })
  if (!r.ok) throw new Error(`YF authed HTTP ${r.status}`)
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

  // Last valid candle close = current extended-hours price
  let extPrice: number | null = null
  for (let i = closes.length - 1; i >= 0; i--) {
    const c = closes[i]
    if (c != null && (c as number) > 0) { extPrice = c as number; break }
  }
  if (extPrice == null) return null

  // Last regular-session candle as change reference.
  // Use regularMarketTime as the session boundary since it's the most reliable field.
  const boundary: number =
    (meta?.currentTradingPeriod?.regular?.end ?? 0) ||
    (meta?.regularMarketTime ?? 0)
  let regularClose: number = meta?.regularMarketPrice ?? extPrice
  if (boundary > 0) {
    for (let i = ts.length - 1; i >= 0; i--) {
      const c = closes[i]
      if (c != null && (c as number) > 0 && ts[i] <= boundary) {
        regularClose = c as number
        break
      }
    }
  }

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
        marketCap: meta.marketCap ?? 0,
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

// ─── getStockStats ────────────────────────────────────────────────────────────

export const getStockStats = createServerFn({ method: 'GET' })
  .inputValidator((s: unknown) => z.string().regex(SYMBOL_RE).parse(s))
  .handler(async ({ data: symbol }) => {
    try {
      const path = `/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=summaryDetail,defaultKeyStatistics,financialData,institutionOwnership&formatted=false`
      const json = await yfFetchAuthed(path)
      const r = json?.quoteSummary?.result?.[0]
      if (!r) return null
      const sd = r.summaryDetail ?? {}
      const ks = r.defaultKeyStatistics ?? {}
      const fd = r.financialData ?? {}
      const io = r.institutionOwnership ?? {}

      const raw = (obj: any, key: string) => {
        const v = obj?.[key]
        if (v == null) return null
        if (typeof v === 'object' && 'raw' in v) return v.raw ?? null
        if (typeof v === 'number') return v
        return null
      }

      const holders = (io.ownershipList ?? []).slice(0, 10).map((h: any) => ({
        name: h.organization?.longFmt ?? h.organization?.fmt ?? '',
        shares: raw(h, 'position'),
        pctHeld: raw(h, 'pctHeld'),
        reportDate: raw(h, 'reportDate'),
      }))

      return {
        peRatio: raw(sd, 'trailingPE'),
        forwardPE: raw(sd, 'forwardPE'),
        eps: raw(ks, 'trailingEps'),
        forwardEps: raw(ks, 'forwardEps'),
        dividendYield: raw(sd, 'dividendYield'),
        beta: raw(sd, 'beta'),
        sharesOutstanding: raw(ks, 'sharesOutstanding'),
        floatShares: raw(ks, 'floatShares'),
        revenue: raw(fd, 'totalRevenue'),
        grossMargins: raw(fd, 'grossMargins'),
        profitMargins: raw(fd, 'profitMargins'),
        debtToEquity: raw(fd, 'debtToEquity'),
        returnOnEquity: raw(fd, 'returnOnEquity'),
        currentRatio: raw(fd, 'currentRatio'),
        marketCap: raw(sd, 'marketCap'),
        bookValue: raw(ks, 'bookValue'),
        priceToBook: raw(ks, 'priceToBook'),
        institutionalHolders: holders,
      }
    } catch {
      return null
    }
  })

// ─── getStockNews ─────────────────────────────────────────────────────────────

export const getStockNews = createServerFn({ method: 'GET' })
  .inputValidator((s: unknown) => z.string().regex(SYMBOL_RE).parse(s))
  .handler(async ({ data: symbol }) => {
    try {
      const url = `${YF1}/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=15&enableFuzzyQuery=false`
      const json = await yfFetch(url)
      const items: any[] = json?.news ?? []
      const seen = new Set<string>()
      return items
        .filter(n => {
          if (!n.uuid || seen.has(n.uuid)) return false
          seen.add(n.uuid)
          return true
        })
        .map(n => ({
          title: n.title ?? '',
          publisher: n.publisher ?? '',
          link: n.link ?? '',
          providerPublishTime: n.providerPublishTime ?? 0,
          uuid: n.uuid,
          thumbnail: (n.thumbnail?.resolutions ?? []).sort((a: any, b: any) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null,
        }))
    } catch {
      return []
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
