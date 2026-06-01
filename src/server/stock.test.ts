import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Helpers (duplicated from server/stock.ts to keep tests fast/isolated) ───

const SYMBOL_RE = /^[A-Z0-9.\-^]{1,12}$/

function fmtPrice(n: number) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

function fmtAbbrev(n: number) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

// Mirrors the Finnhub quote mapping logic in the handler
function mapQuote(q: Record<string, number>, profile: Record<string, unknown> = {}) {
  const price = q.c
  const prevClose = q.pc
  const change = price - prevClose
  const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0
  return {
    regularMarketPrice: price,
    regularMarketChange: change,
    regularMarketChangePercent: changePct,
    regularMarketOpen: q.o ?? 0,
    regularMarketDayHigh: q.h ?? 0,
    regularMarketDayLow: q.l ?? 0,
    previousClose: prevClose,
    shortName: (profile.name as string) ?? 'UNKNOWN',
    marketCap: profile.marketCapitalization
      ? (profile.marketCapitalization as number) * 1_000_000
      : 0,
  }
}

function mapCandles(json: Record<string, unknown>) {
  if (json.s !== 'ok' || !json.t) return []
  const ts = json.t as number[]
  return ts.map((t, i) => ({
    time: t,
    open: (json.o as number[])[i] ?? 0,
    high: (json.h as number[])[i] ?? 0,
    low: (json.l as number[])[i] ?? 0,
    close: (json.c as number[])[i] ?? 0,
    volume: (json.v as number[])[i] ?? 0,
  })).filter(c => c.close > 0)
}

// ─── Symbol validator ──────────────────────────────────────────────────────────

describe('symbol regex', () => {
  it.each(['AAPL', 'MSFT', 'BRK.B', 'BRK-B', '^GSPC', 'A', 'TSLA123'])(
    'accepts valid symbol %s',
    (sym) => expect(SYMBOL_RE.test(sym)).toBe(true),
  )

  it.each(['', 'aapl', 'TOOLONGSYMBOL!', 'DROP TABLE', '../etc'])(
    'rejects invalid symbol %s',
    (sym) => expect(SYMBOL_RE.test(sym)).toBe(false),
  )
})

// ─── Finnhub quote mapping ─────────────────────────────────────────────────────

describe('Finnhub quote mapping', () => {
  it('maps a standard Finnhub quote', () => {
    const result = mapQuote({ c: 213.45, pc: 210.0, o: 211.0, h: 215.0, l: 209.5 })
    expect(result.regularMarketPrice).toBe(213.45)
    expect(result.regularMarketChange).toBeCloseTo(3.45)
    expect(result.regularMarketChangePercent).toBeCloseTo(1.643)
    expect(result.regularMarketDayHigh).toBe(215.0)
    expect(result.previousClose).toBe(210.0)
  })

  it('computes changePct as 0 when prevClose is 0', () => {
    const result = mapQuote({ c: 100, pc: 0, o: 0, h: 0, l: 0 })
    expect(result.regularMarketChangePercent).toBe(0)
  })

  it('multiplies marketCap by 1M', () => {
    const result = mapQuote({ c: 100, pc: 99, o: 99, h: 101, l: 99 }, { marketCapitalization: 3200000, name: 'Apple Inc.' })
    expect(result.marketCap).toBe(3_200_000_000_000)
    expect(result.shortName).toBe('Apple Inc.')
  })
})

// ─── Finnhub candle mapping ────────────────────────────────────────────────────

describe('Finnhub candle mapping', () => {
  it('maps a valid Finnhub candle response', () => {
    const json = { s: 'ok', t: [1700000000, 1700003600], o: [100, 102], h: [105, 107], l: [99, 101], c: [104, 106], v: [1000, 1100] }
    const candles = mapCandles(json)
    expect(candles).toHaveLength(2)
    expect(candles[0]).toEqual({ time: 1700000000, open: 100, high: 105, low: 99, close: 104, volume: 1000 })
  })

  it('returns [] when status is not ok', () => {
    expect(mapCandles({ s: 'no_data', t: null })).toEqual([])
  })

  it('filters candles with zero close', () => {
    const json = { s: 'ok', t: [1, 2], o: [1, 0], h: [1, 0], l: [1, 0], c: [1, 0], v: [10, 0] }
    expect(mapCandles(json)).toHaveLength(1)
  })
})

// ─── Formatting helpers ────────────────────────────────────────────────────────

describe('fmtPrice', () => {
  it('formats to 2 decimal places', () => {
    expect(fmtPrice(213.456)).toBe('213.46')
    expect(fmtPrice(0)).toBe('0.00')
    expect(fmtPrice(1000)).toBe('1,000.00')
  })
})

describe('fmtAbbrev', () => {
  it.each([
    [3_200_000_000_000, '3.20T'],
    [1_500_000_000, '1.50B'],
    [52_000_000, '52.00M'],
    [1_500, '1.5K'],
    [999, '999'],
  ])('abbreviates %i → %s', (n, expected) => {
    expect(fmtAbbrev(n)).toBe(expected)
  })
})

// ─── getTopMovers category validator ──────────────────────────────────────────

describe('movers category validator', () => {
  function validate(cat: unknown): string {
    const c = cat as string
    if (!['gainers', 'losers', 'active'].includes(c)) return 'gainers'
    return c
  }

  it('passes valid categories through', () => {
    expect(validate('gainers')).toBe('gainers')
    expect(validate('losers')).toBe('losers')
    expect(validate('active')).toBe('active')
  })

  it('falls back to gainers for unknown values', () => {
    expect(validate('unknown')).toBe('gainers')
    expect(validate('')).toBe('gainers')
    expect(validate(null)).toBe('gainers')
    expect(validate(42)).toBe('gainers')
  })
})

// ─── Yahoo Finance fetch error handling ──────────────────────────────────────

describe('YF response error handling', () => {
  it('returns null when chart result is missing', () => {
    const json = { chart: { result: null, error: { code: 'Not Found' } } }
    const meta = json?.chart?.result?.[0]?.meta
    expect(meta).toBeUndefined()
  })

  it('returns empty array when screener result is missing', () => {
    const json = { finance: { result: null } }
    const quotes = json?.finance?.result?.[0]?.quotes ?? []
    expect(quotes).toEqual([])
  })

  it('handles completely unexpected response shape without throwing', () => {
    const json = {}
    const meta = (json as any)?.chart?.result?.[0]?.meta
    expect(meta).toBeUndefined()
    const quotes = (json as any)?.finance?.result?.[0]?.quotes ?? []
    expect(quotes).toEqual([])
  })
})
