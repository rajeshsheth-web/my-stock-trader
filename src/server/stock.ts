import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const SYMBOL_RE = /^[A-Z0-9.\-^]{1,12}$/
const YF1 = 'https://query1.finance.yahoo.com'
const YF2 = 'https://query2.finance.yahoo.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const UA_SIMPLE = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

async function yfFetch(url: string) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA_SIMPLE, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(5000),
  })
  if (!r.ok) throw new Error(`YF HTTP ${r.status}`)
  return r.json()
}

// Yahoo Finance v10 requires a crumb+cookie pair. Cache in module scope.
let _crumbCache: { crumb: string; cookie: string; expiresAt: number } | null = null

async function getYahooCrumb() {
  if (_crumbCache && _crumbCache.expiresAt > Date.now()) return _crumbCache

  // Step 1: hit finance.yahoo.com to get a session cookie
  const consentRes = await fetch('https://finance.yahoo.com/', {
    headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(10000),
    redirect: 'follow',
  })
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

// Extended hours pricing from v7/finance/quote (works in all market states incl CLOSED/overnight)
async function fetchExtendedHours(symbol: string) {
  try {
    const url = `${YF1}/v7/finance/quote?symbols=${encodeURIComponent(symbol)}&fields=marketState,preMarketPrice,preMarketChange,preMarketChangePercent,postMarketPrice,postMarketChange,postMarketChangePercent`
    const json = await yfFetch(url)
    const q = json?.quoteResponse?.result?.[0]
    if (!q) return null
    const ms: string = q.marketState ?? 'CLOSED'
    const isPreMarket = ms === 'PRE' || ms === 'PREPRE'
    const isPre = isPreMarket && q.preMarketPrice != null && q.preMarketPrice > 0
    const isPost = !isPreMarket && ms !== 'REGULAR' && q.postMarketPrice != null && q.postMarketPrice > 0
    if (!isPre && !isPost) return null
    return {
      preMarketPrice: isPre ? (q.preMarketPrice as number) : null,
      preMarketChange: isPre ? (q.preMarketChange as number ?? null) : null,
      preMarketChangePercent: isPre ? (q.preMarketChangePercent as number ?? null) : null,
      postMarketPrice: isPost ? (q.postMarketPrice as number) : null,
      postMarketChange: isPost ? (q.postMarketChange as number ?? null) : null,
      postMarketChangePercent: isPost ? (q.postMarketChangePercent as number ?? null) : null,
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
      const [result, ext] = await Promise.all([
        fetchChart(symbol, '5d', '15m'),
        fetchExtendedHours(symbol),
      ])
      if (!result) return null
      const meta = result.meta
      if (!meta?.regularMarketPrice) return null

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
      const [result, ext] = await Promise.all([
        fetchChart(symbol, '5d', '15m'),
        fetchExtendedHours(symbol),
      ])
      if (!result) return null
      const meta = result.meta
      if (!meta?.regularMarketPrice) return null

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

async function fetchV7Quote(symbol: string) {
  // v7/quote returns most fundamental fields without crumb auth
  const fields = [
    'trailingPE', 'forwardPE', 'epsTrailingTwelveMonths', 'epsForward',
    'dividendYield', 'beta', 'sharesOutstanding', 'floatShares',
    'marketCap', 'bookValue', 'priceToBook',
    'totalRevenue', 'grossMargins', 'profitMargins',
    'debtToEquity', 'returnOnEquity', 'currentRatio',
  ].join(',')
  const url = `${YF1}/v7/finance/quote?symbols=${encodeURIComponent(symbol)}&fields=${fields}`
  const json = await yfFetch(url)
  return json?.quoteResponse?.result?.[0] ?? null
}

async function fetchInstitutionalHolders(symbol: string) {
  try {
    const path = `/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=institutionOwnership&formatted=false`
    const json = await yfFetchAuthed(path)
    const io = json?.quoteSummary?.result?.[0]?.institutionOwnership ?? {}
    const raw = (obj: any, key: string) => {
      const v = obj?.[key]
      if (v == null) return null
      if (typeof v === 'object' && 'raw' in v) return v.raw ?? null
      if (typeof v === 'number') return v
      return null
    }
    return (io.ownershipList ?? []).slice(0, 10).map((h: any) => ({
      name: h.organization?.longFmt ?? h.organization?.fmt ?? '',
      shares: raw(h, 'position'),
      pctHeld: raw(h, 'pctHeld'),
      reportDate: raw(h, 'reportDate'),
    }))
  } catch {
    return []
  }
}

export const getStockStats = createServerFn({ method: 'GET' })
  .inputValidator((s: unknown) => z.string().regex(SYMBOL_RE).parse(s))
  .handler(async ({ data: symbol }) => {
    try {
      const [q, holders] = await Promise.all([
        fetchV7Quote(symbol),
        fetchInstitutionalHolders(symbol),
      ])
      if (!q) return null

      const n = (key: string): number | null => {
        const v = q[key]
        return (typeof v === 'number' && isFinite(v)) ? v : null
      }

      return {
        peRatio: n('trailingPE'),
        forwardPE: n('forwardPE'),
        eps: n('epsTrailingTwelveMonths'),
        forwardEps: n('epsForward'),
        dividendYield: n('dividendYield'),
        beta: n('beta'),
        sharesOutstanding: n('sharesOutstanding'),
        floatShares: n('floatShares'),
        revenue: n('totalRevenue'),
        grossMargins: n('grossMargins'),
        profitMargins: n('profitMargins'),
        debtToEquity: n('debtToEquity'),
        returnOnEquity: n('returnOnEquity'),
        currentRatio: n('currentRatio'),
        marketCap: n('marketCap'),
        bookValue: n('bookValue'),
        priceToBook: n('priceToBook'),
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
