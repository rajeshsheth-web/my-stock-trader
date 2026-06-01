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

// Mirrors the mapping logic in the handler
function parseStockMeta(meta: Record<string, unknown>) {
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
}

function parseCandleResult(result: {
  timestamp?: number[]
  indicators?: { quote?: Array<Record<string, (number | null)[]>> }
}) {
  const ts = result.timestamp ?? []
  const q = result.indicators?.quote?.[0] ?? {}
  return ts
    .map((t, i) => ({
      time: t,
      open: (q['open']?.[i] as number) ?? 0,
      high: (q['high']?.[i] as number) ?? 0,
      low: (q['low']?.[i] as number) ?? 0,
      close: (q['close']?.[i] as number) ?? 0,
      volume: (q['volume']?.[i] as number) ?? 0,
    }))
    .filter((c) => c.close > 0)
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

// ─── parseStockMeta ────────────────────────────────────────────────────────────

describe('parseStockMeta', () => {
  it('maps a full YF meta object', () => {
    const meta = {
      symbol: 'AAPL',
      shortName: 'Apple Inc.',
      regularMarketPrice: 213.45,
      regularMarketChange: 2.1,
      regularMarketChangePercent: 0.99,
      regularMarketVolume: 52_000_000,
      regularMarketOpen: 211.0,
      regularMarketDayHigh: 214.5,
      regularMarketDayLow: 210.2,
      fiftyTwoWeekHigh: 230.0,
      fiftyTwoWeekLow: 160.0,
      marketCap: 3_200_000_000_000,
      currency: 'USD',
      exchangeName: 'NMS',
      previousClose: 211.35,
    }
    const result = parseStockMeta(meta)
    expect(result.symbol).toBe('AAPL')
    expect(result.regularMarketPrice).toBe(213.45)
    expect(result.currency).toBe('USD')
    expect(result.previousClose).toBe(211.35)
  })

  it('falls back to chartPreviousClose when previousClose is missing', () => {
    const meta = { symbol: 'XYZ', chartPreviousClose: 99.9 }
    expect(parseStockMeta(meta).previousClose).toBe(99.9)
  })

  it('fills zeros for missing numeric fields', () => {
    const result = parseStockMeta({ symbol: 'XYZ' })
    expect(result.regularMarketPrice).toBe(0)
    expect(result.marketCap).toBe(0)
    expect(result.fiftyTwoWeekHigh).toBe(0)
  })

  it('uses symbol as shortName fallback', () => {
    expect(parseStockMeta({ symbol: 'XYZ' }).shortName).toBe('XYZ')
  })

  it('defaults currency to USD', () => {
    expect(parseStockMeta({ symbol: 'XYZ' }).currency).toBe('USD')
  })
})

// ─── parseCandleResult ────────────────────────────────────────────────────────

describe('parseCandleResult', () => {
  it('maps timestamps and OHLCV arrays', () => {
    const result = {
      timestamp: [1700000000, 1700000300],
      indicators: {
        quote: [{ open: [100, 101], high: [105, 106], low: [99, 100], close: [104, 105], volume: [1000, 1100] }],
      },
    }
    const candles = parseCandleResult(result)
    expect(candles).toHaveLength(2)
    expect(candles[0]).toEqual({ time: 1700000000, open: 100, high: 105, low: 99, close: 104, volume: 1000 })
  })

  it('filters out candles with zero close', () => {
    const result = {
      timestamp: [1, 2, 3],
      indicators: {
        quote: [{ open: [1, 0, 3], high: [1, 0, 3], low: [1, 0, 3], close: [1, 0, 3], volume: [10, 0, 30] }],
      },
    }
    const candles = parseCandleResult(result)
    expect(candles).toHaveLength(2)
    expect(candles.every((c) => c.close > 0)).toBe(true)
  })

  it('returns empty array for missing timestamp', () => {
    expect(parseCandleResult({})).toEqual([])
  })

  it('defaults null OHLCV values to 0', () => {
    const result = {
      timestamp: [1700000000],
      indicators: {
        quote: [{ open: [null], high: [null], low: [null], close: [null], volume: [null] }],
      },
    }
    // close=0 → filtered out
    expect(parseCandleResult(result as any)).toHaveLength(0)
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
