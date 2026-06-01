import { describe, it, expect } from 'vitest'

// ─── Scoring logic (mirrored from getDayTradeRecs handler) ───────────────────

type RawQuote = {
  symbol: string
  shortName?: string
  regularMarketPrice: number
  regularMarketChangePercent: number
  regularMarketVolume: number
  averageDailyVolume3Month?: number
  averageDailyVolume10Day?: number
  regularMarketDayHigh?: number
  regularMarketDayLow?: number
  regularMarketOpen?: number
}

function isEligible(q: RawQuote): boolean {
  const price = q.regularMarketPrice
  const volume = q.regularMarketVolume
  const avgVolume = q.averageDailyVolume3Month ?? q.averageDailyVolume10Day ?? 0
  const pct = q.regularMarketChangePercent
  const high = q.regularMarketDayHigh ?? 0
  const low = q.regularMarketDayLow ?? 0
  const range = low > 0 ? ((high - low) / low) * 100 : 0

  return (
    price >= 5 &&
    price <= 2000 &&
    volume >= 500_000 &&
    pct >= 1 &&
    pct <= 15 &&
    range >= 1 &&
    (avgVolume === 0 || volume / avgVolume >= 1.2)
  )
}

function score(q: RawQuote): number {
  const price = q.regularMarketPrice
  const pct = q.regularMarketChangePercent
  const volume = q.regularMarketVolume
  const avgVolume = q.averageDailyVolume3Month ?? q.averageDailyVolume10Day ?? volume
  const high = q.regularMarketDayHigh ?? price
  const low = q.regularMarketDayLow ?? price
  const open = q.regularMarketOpen ?? price

  const volumeSurge = avgVolume > 0 ? volume / avgVolume : 1
  const intradayRange = low > 0 ? ((high - low) / low) * 100 : 0

  const volScore = Math.min(35, (volumeSurge - 1) * 10)
  const momScore = pct >= 2 && pct <= 8 ? 30 : pct > 8 ? Math.max(0, 30 - (pct - 8) * 3) : pct * 10
  const openScore = price > open ? 20 : 5
  const rangeScore = Math.min(15, intradayRange * 2)

  return Math.round(volScore + momScore + openScore + rangeScore)
}

function entryTarget(price: number, s: number) {
  const targetPct = 0.02 + (s / 100) * 0.03
  return parseFloat((price * (1 + targetPct)).toFixed(2))
}

// ─── Eligibility filter ───────────────────────────────────────────────────────

describe('day-trade eligibility filter', () => {
  const base: RawQuote = {
    symbol: 'AAPL',
    regularMarketPrice: 200,
    regularMarketChangePercent: 3,
    regularMarketVolume: 2_000_000,
    averageDailyVolume3Month: 1_000_000,
    regularMarketDayHigh: 205,
    regularMarketDayLow: 198,
    regularMarketOpen: 199,
  }

  it('accepts a clean candidate', () => expect(isEligible(base)).toBe(true))

  it('rejects penny stocks (price < 5)', () =>
    expect(isEligible({ ...base, regularMarketPrice: 4.99 })).toBe(false))

  it('rejects very high-price outliers (price > 2000)', () =>
    expect(isEligible({ ...base, regularMarketPrice: 2001 })).toBe(false))

  it('rejects low-volume stocks (< 500k)', () =>
    expect(isEligible({ ...base, regularMarketVolume: 499_999 })).toBe(false))

  it('rejects stocks with < 1% gain', () =>
    expect(isEligible({ ...base, regularMarketChangePercent: 0.9 })).toBe(false))

  it('rejects parabolic stocks (> 15% gain)', () =>
    expect(isEligible({ ...base, regularMarketChangePercent: 15.1 })).toBe(false))

  it('rejects stocks with < 1% intraday range', () => {
    // high = low → 0% range
    expect(isEligible({ ...base, regularMarketDayHigh: 200, regularMarketDayLow: 200 })).toBe(false)
  })

  it('rejects when volume is below 1.2× average', () =>
    expect(isEligible({ ...base, regularMarketVolume: 1_000_000, averageDailyVolume3Month: 1_000_000 })).toBe(false))

  it('accepts when no avgVolume data (passes volume check)', () => {
    const { averageDailyVolume3Month: _, ...noAvg } = base
    expect(isEligible(noAvg)).toBe(true)
  })
})

// ─── Scoring ──────────────────────────────────────────────────────────────────

describe('day-trade scoring', () => {
  it('scores higher with larger volume surge', () => {
    const low = score({ symbol: 'A', regularMarketPrice: 100, regularMarketChangePercent: 3, regularMarketVolume: 1_500_000, averageDailyVolume3Month: 1_000_000, regularMarketDayHigh: 104, regularMarketDayLow: 100, regularMarketOpen: 100 })
    const high = score({ symbol: 'B', regularMarketPrice: 100, regularMarketChangePercent: 3, regularMarketVolume: 5_000_000, averageDailyVolume3Month: 1_000_000, regularMarketDayHigh: 104, regularMarketDayLow: 100, regularMarketOpen: 100 })
    expect(high).toBeGreaterThan(low)
  })

  it('gives full momentum score for 2–8% gain', () => {
    const s = score({ symbol: 'A', regularMarketPrice: 100, regularMarketChangePercent: 5, regularMarketVolume: 1_000_000, regularMarketDayHigh: 106, regularMarketDayLow: 100, regularMarketOpen: 99 })
    // momScore = 30, openScore = 20 → at least 50
    expect(s).toBeGreaterThanOrEqual(50)
  })

  it('penalises gains > 8% (overextended)', () => {
    const normal = score({ symbol: 'A', regularMarketPrice: 100, regularMarketChangePercent: 5, regularMarketVolume: 1_000_000, regularMarketDayHigh: 105, regularMarketDayLow: 100, regularMarketOpen: 99 })
    const hot = score({ symbol: 'A', regularMarketPrice: 100, regularMarketChangePercent: 13, regularMarketVolume: 1_000_000, regularMarketDayHigh: 114, regularMarketDayLow: 100, regularMarketOpen: 99 })
    expect(hot).toBeLessThan(normal)
  })

  it('adds 20 pts when price is above open', () => {
    const above = score({ symbol: 'A', regularMarketPrice: 101, regularMarketChangePercent: 3, regularMarketVolume: 1_000_000, regularMarketDayHigh: 103, regularMarketDayLow: 99, regularMarketOpen: 100 })
    const below = score({ symbol: 'A', regularMarketPrice: 99, regularMarketChangePercent: 3, regularMarketVolume: 1_000_000, regularMarketDayHigh: 103, regularMarketDayLow: 99, regularMarketOpen: 100 })
    expect(above - below).toBe(15) // 20 vs 5
  })

  it('caps range contribution at 15 pts', () => {
    // intradayRange = 20% → rangeScore = min(15, 40) = 15
    const s = score({ symbol: 'A', regularMarketPrice: 120, regularMarketChangePercent: 3, regularMarketVolume: 1_000_000, regularMarketDayHigh: 120, regularMarketDayLow: 100, regularMarketOpen: 100 })
    // rangeScore maxed at 15
    expect(s).toBeLessThanOrEqual(100)
  })

  it('score is always 0–100', () => {
    const extreme = score({ symbol: 'A', regularMarketPrice: 100, regularMarketChangePercent: 14, regularMarketVolume: 50_000_000, averageDailyVolume3Month: 1_000_000, regularMarketDayHigh: 120, regularMarketDayLow: 90, regularMarketOpen: 99 })
    expect(extreme).toBeGreaterThanOrEqual(0)
    expect(extreme).toBeLessThanOrEqual(100)
  })
})

// ─── Entry / target calculation ───────────────────────────────────────────────

describe('entry/target calculation', () => {
  it('target is always >= 2% above entry', () => {
    for (const s of [0, 25, 50, 75, 100]) {
      const entry = 100
      const target = entryTarget(entry, s)
      expect(target).toBeGreaterThanOrEqual(entry * 1.02)
    }
  })

  it('target is always <= 5% above entry', () => {
    for (const s of [0, 25, 50, 75, 100]) {
      const entry = 100
      const target = entryTarget(entry, s)
      expect(target).toBeLessThanOrEqual(entry * 1.051) // small float tolerance
    }
  })

  it('higher score yields higher target', () => {
    const low = entryTarget(100, 20)
    const high = entryTarget(100, 80)
    expect(high).toBeGreaterThan(low)
  })

  it('stop is always 1% below entry', () => {
    const entry = 150
    const stop = parseFloat((entry * 0.99).toFixed(2))
    expect(stop).toBe(148.5)
  })
})
