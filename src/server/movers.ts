import { createServerFn } from '@tanstack/react-start'

async function fetchWithTimeout(url: string, opts: RequestInit = {}, ms = 4500) {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), ms)
  try { return await fetch(url, { ...opts, signal: ctrl.signal }) }
  finally { clearTimeout(id) }
}

export const getTopMovers = createServerFn({ method: 'GET' })
  .validator((cat: unknown) => {
    const c = cat as string
    if (!['gainers','losers','active'].includes(c)) return 'gainers'
    return c
  })
  .handler(async ({ data: category }) => {
    try {
      const scrIds: Record<string,string> = {
        gainers: 'day_gainers',
        losers: 'day_losers',
        active: 'most_actives',
      }
      const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=${scrIds[category]}&count=20`
      const r = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!r.ok) return []
      const json = await r.json()
      const quotes = json?.finance?.result?.[0]?.quotes ?? []
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
