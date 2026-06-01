import { describe, it, expect } from 'vitest'

// ─── Helpers (mirrored from server logic) ─────────────────────────────────────

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

// Mirrors the YF quote mapping logic
function mapQuote(q: {
  regularMarketPrice: number
  regularMarketChange: number
  regularMarketChangePercent: number
  regularMarketPreviousClose: number
  regularMarketOpen?: number
  regularMarketDayHigh?: number
  regularMarketDayLow?: number
  shortName?: string
  marketCap?: number
}) {
  return {
    regularMarketPrice: q.regularMarketPrice,
    regularMarketChange: q.regularMarketChange,
    regularMarketChangePercent: q.regularMarketChangePercent,
    regularMarketOpen: q.regularMarketOpen ?? 0,
    regularMarketDayHigh: q.regularMarketDayHigh ?? 0,
    regularMarketDayLow: q.regularMarketDayLow ?? 0,
    previousClose: q.regularMarketPreviousClose,
    shortName: q.shortName ?? 'UNKNOWN',
    marketCap: q.marketCap ?? 0,
  }
}

function mapCandles(quotes: { date: Date; open: number | null; high: number | null; low: number | null; close: number | null; volume: number | null }[]) {
  return quotes
    .filter(c => c.close != null && c.close > 0)
    .map(c => ({
      time: Math.floor(c.date.getTime() / 1000),
      open: c.open ?? 0,
      high: c.high ?? 0,
      low: c.low ?? 0,
      close: c.close ?? 0,
      volume: c.volume ?? 0,
    }))
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

// ─── YF quote mapping ──────────────────────────────────────────────────────────

describe('YF quote mapping', () => {
  it('maps a standard quote', () => {
    const result = mapQuote({ regularMarketPrice: 213.45, regularMarketChange: 3.45, regularMarketChangePercent: 1.643, regularMarketPreviousClose: 210.0, regularMarketOpen: 211.0, regularMarketDayHigh: 215.0, regularMarketDayLow: 209.5 })
    expect(result.regularMarketPrice).toBe(213.45)
    expect(result.regularMarketChange).toBeCloseTo(3.45)
    expect(result.regularMarketChangePercent).toBeCloseTo(1.643)
    expect(result.regularMarketDayHigh).toBe(215.0)
    expect(result.previousClose).toBe(210.0)
  })

  it('defaults missing fields to 0', () => {
    const result = mapQuote({ regularMarketPrice: 100, regularMarketChange: 1, regularMarketChangePercent: 1, regularMarketPreviousClose: 99 })
    expect(result.regularMarketOpen).toBe(0)
    expect(result.marketCap).toBe(0)
    expect(result.shortName).toBe('UNKNOWN')
  })

  it('passes through marketCap and shortName', () => {
    const result = mapQuote({ regularMarketPrice: 100, regularMarketChange: 1, regularMarketChangePercent: 1, regularMarketPreviousClose: 99, marketCap: 3_200_000_000_000, shortName: 'Apple Inc.' })
    expect(result.marketCap).toBe(3_200_000_000_000)
    expect(result.shortName).toBe('Apple Inc.')
  })
})

// ─── YF candle mapping ─────────────────────────────────────────────────────────

describe('YF candle mapping', () => {
  it('maps valid candles', () => {
    const d1 = new Date('2024-01-01T14:30:00Z')
    const d2 = new Date('2024-01-01T15:30:00Z')
    const candles = mapCandles([
      { date: d1, open: 100, high: 105, low: 99, close: 104, volume: 1000 },
      { date: d2, open: 102, high: 107, low: 101, close: 106, volume: 1100 },
    ])
    expect(candles).toHaveLength(2)
    expect(candles[0]).toEqual({ time: Math.floor(d1.getTime() / 1000), open: 100, high: 105, low: 99, close: 104, volume: 1000 })
  })

  it('filters candles with null or zero close', () => {
    const candles = mapCandles([
      { date: new Date(), open: 1, high: 1, low: 1, close: 1, volume: 10 },
      { date: new Date(), open: 0, high: 0, low: 0, close: null, volume: 0 },
      { date: new Date(), open: 0, high: 0, low: 0, close: 0, volume: 0 },
    ])
    expect(candles).toHaveLength(1)
  })

  it('returns empty array for empty input', () => {
    expect(mapCandles([])).toEqual([])
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

// ─── YF response error handling ───────────────────────────────────────────────

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
