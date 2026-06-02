import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createChart,
  AreaSeries,
  CandlestickSeries,
  LineSeries,
  BaselineSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts'
import { getRangeCandles, getStockQuote } from '@/server/stock'

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = {
  background: '#ffffff',
  text: '#1b1f23',
  grid: '#e1e5eb',
  border: '#e1e5eb',
  up: '#00873c',
  down: '#eb0f29',
  primary: '#7e1fff',
  areaTop: 'rgba(126,31,255,0.15)',
  areaBottom: 'rgba(126,31,255,0)',
  volumeUp: 'rgba(0,135,60,0.5)',
  volumeDown: 'rgba(235,15,41,0.5)',
}

const SESSION_DEFS = [
  { hh: 4,  mm: 0,  label: 'Pre',   color: 'rgba(217,119,6,0.65)',  dash: true  },
  { hh: 9,  mm: 30, label: 'Open',  color: 'rgba(0,135,60,0.85)',   dash: false },
  { hh: 16, mm: 0,  label: 'Close', color: 'rgba(235,15,41,0.85)',  dash: false },
  { hh: 20, mm: 0,  label: 'AH',    color: 'rgba(217,119,6,0.65)',  dash: true  },
]

type RangeKey = '1D' | '5D' | '1M' | '6M' | 'YTD' | '1Y' | '5Y' | 'Max'
type ModeKey = 'Area' | 'Candlestick' | 'Line' | 'Baseline'

// 1D loads 10d at 5m so the user can scroll back through previous sessions
const RANGES: { key: RangeKey; range: string; interval: string }[] = [
  { key: '1D',  range: '10d',  interval: '5m'  },
  { key: '5D',  range: '5d',   interval: '15m' },
  { key: '1M',  range: '1mo',  interval: '1d'  },
  { key: '6M',  range: '6mo',  interval: '1d'  },
  { key: 'YTD', range: 'ytd',  interval: '1d'  },
  { key: '1Y',  range: '1y',   interval: '1wk' },
  { key: '5Y',  range: '5y',   interval: '1wk' },
  { key: 'Max', range: 'max',  interval: '1mo' },
]

const MODES: ModeKey[] = ['Area', 'Candlestick', 'Line', 'Baseline']

interface Candle {
  time: number; open: number; high: number; low: number; close: number; volume: number
}

export interface YFChartProps { symbol: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Returns ET session boundary timestamps for the trading day that contains anyTs.
function getSessionBoundaryTs(anyTs: number) {
  const d = new Date(anyTs * 1000)
  const nyWall = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const utcOffsetMs = d.getTime() - nyWall.getTime()
  nyWall.setHours(0, 0, 0, 0)
  return SESSION_DEFS.map(({ hh, mm, label, color, dash }) => {
    const t = new Date(nyWall); t.setHours(hh, mm, 0, 0)
    return { time: Math.floor((t.getTime() + utcOffsetMs) / 1000), label, color, dash }
  })
}

// Returns session boundaries for every unique NY trading day present in the candle array.
function allSessionBoundaries(candles: Candle[]) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
  const seen = new Set<string>()
  const result: ReturnType<typeof getSessionBoundaryTs> = []
  for (const c of candles) {
    const day = fmt.format(new Date(c.time * 1000))
    if (!seen.has(day)) { seen.add(day); result.push(...getSessionBoundaryTs(c.time)) }
  }
  return result
}

// ─── Component ────────────────────────────────────────────────────────────────

export function YFChart({ symbol }: YFChartProps) {
  const [rangeKey, setRangeKey] = useState<RangeKey>('1D')
  const [mode, setMode] = useState<ModeKey>('Area')
  const [candles, setCandles] = useState<Candle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [isExtendedHours, setIsExtendedHours] = useState(false)
  const [sessionLines, setSessionLines] = useState<{ x: number; label: string; color: string; dash: boolean }[]>([])

  const priceRef = useRef<HTMLDivElement>(null)
  const volumeRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const volChartRef = useRef<IChartApi | null>(null)
  const priceSeriesRef = useRef<ISeriesApi<'Area' | 'Candlestick' | 'Line' | 'Baseline'> | null>(null)
  const volSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const sessionBoundsRef = useRef<ReturnType<typeof getSessionBoundaryTs>>([])

  // ── Fetch candles ──────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setSessionLines([])
    const cfg = RANGES.find(r => r.key === rangeKey)!
    getRangeCandles({ data: { symbol, range: cfg.range, interval: cfg.interval } })
      .then(data => { if (!cancelled) { setCandles(data as Candle[]); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [symbol, rangeKey])

  // ── Session line x-positions ───────────────────────────────────────────────

  const refreshSessionLines = useCallback(() => {
    const chart = chartRef.current
    if (!chart || !priceRef.current) return
    const scale = chart.timeScale()
    const width = priceRef.current.clientWidth
    setSessionLines(
      sessionBoundsRef.current
        .map(b => ({ ...b, x: scale.timeToCoordinate(b.time as any) ?? -1 }))
        .filter(l => l.x >= 0 && l.x <= width)
    )
  }, [])

  // ── Create/destroy charts ─────────────────────────────────────────────────

  useEffect(() => {
    if (!priceRef.current || !volumeRef.current) return

    // Use local timezone for x-axis labels
    const timeFormatter = (ts: number) => {
      const d = new Date(ts * 1000)
      const h = d.getHours(), m = d.getMinutes()
      if (h === 0 && m === 0) {
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
      }
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    }

    const sharedOpts = {
      layout: { background: { color: COLORS.background }, textColor: COLORS.text },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      crosshair: { mode: 1 as const },
      rightPriceScale: { borderColor: COLORS.border },
      handleScroll: true,
      handleScale: true,
      localization: { timeFormatter },
    }

    const priceChart = createChart(priceRef.current, {
      ...sharedOpts,
      height: 280,
      timeScale: { borderColor: COLORS.border, timeVisible: true, secondsVisible: false, rightOffset: 5 },
    })
    const volChart = createChart(volumeRef.current, {
      ...sharedOpts,
      height: 70,
      timeScale: { visible: false },
      rightPriceScale: { borderColor: COLORS.border, scaleMargins: { top: 0.1, bottom: 0 } },
    })

    chartRef.current = priceChart
    volChartRef.current = volChart

    priceChart.subscribeCrosshairMove(param => {
      if (param.time) (volChart as any).setCrossHairXY(param.point?.x ?? 0, 0, true)
    })
    priceChart.timeScale().subscribeVisibleLogicalRangeChange(refreshSessionLines)

    const ro = new ResizeObserver(() => {
      if (priceRef.current) priceChart.resize(priceRef.current.clientWidth, 280)
      if (volumeRef.current) volChart.resize(volumeRef.current.clientWidth, 70)
      refreshSessionLines()
    })
    ro.observe(priceRef.current)

    return () => {
      ro.disconnect()
      priceChart.remove(); volChart.remove()
      chartRef.current = null; volChartRef.current = null
      priceSeriesRef.current = null; volSeriesRef.current = null
    }
  }, [refreshSessionLines])

  // ── Update series when candles / mode change ──────────────────────────────

  useEffect(() => {
    const chart = chartRef.current
    const volChart = volChartRef.current
    if (!chart || !volChart || loading || error) return

    if (priceSeriesRef.current) { try { chart.removeSeries(priceSeriesRef.current) } catch {} ; priceSeriesRef.current = null }
    if (volSeriesRef.current) { try { volChart.removeSeries(volSeriesRef.current) } catch {} ; volSeriesRef.current = null }
    if (candles.length === 0) return

    const sorted = [...candles].sort((a, b) => a.time - b.time)

    let priceSeries: ISeriesApi<'Area' | 'Candlestick' | 'Line' | 'Baseline'>
    if (mode === 'Area') {
      const s = chart.addSeries(AreaSeries, { lineColor: COLORS.primary, topColor: COLORS.areaTop, bottomColor: COLORS.areaBottom, lineWidth: 2 })
      s.setData(sorted.map(c => ({ time: c.time as any, value: c.close })))
      priceSeries = s
    } else if (mode === 'Candlestick') {
      const s = chart.addSeries(CandlestickSeries, { upColor: COLORS.up, downColor: COLORS.down, borderUpColor: COLORS.up, borderDownColor: COLORS.down, wickUpColor: COLORS.up, wickDownColor: COLORS.down })
      s.setData(sorted.map(c => ({ time: c.time as any, open: c.open, high: c.high, low: c.low, close: c.close })))
      priceSeries = s
    } else if (mode === 'Line') {
      const s = chart.addSeries(LineSeries, { color: COLORS.primary, lineWidth: 2 })
      s.setData(sorted.map(c => ({ time: c.time as any, value: c.close })))
      priceSeries = s
    } else {
      const s = chart.addSeries(BaselineSeries, {
        baseValue: { type: 'price', price: sorted[0]?.close ?? 0 },
        topLineColor: COLORS.up, topFillColor1: 'rgba(0,135,60,0.15)', topFillColor2: 'rgba(0,135,60,0)',
        bottomLineColor: COLORS.down, bottomFillColor1: 'rgba(235,15,41,0)', bottomFillColor2: 'rgba(235,15,41,0.15)',
      })
      s.setData(sorted.map(c => ({ time: c.time as any, value: c.close })))
      priceSeries = s
    }
    priceSeriesRef.current = priceSeries

    const volSeries = volChart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'right' })
    volSeries.setData(sorted.map(c => ({ time: c.time as any, value: c.volume, color: c.close >= c.open ? COLORS.volumeUp : COLORS.volumeDown })))
    volSeriesRef.current = volSeries

    if (rangeKey === '1D') {
      // Find the start of the most recent trading day (4 AM ET pre-market open)
      const lastTs = sorted[sorted.length - 1].time
      const bounds = getSessionBoundaryTs(lastTs)
      const preOpenTs = bounds[0].time // 4 AM ET

      // Find the first candle of that session in the sorted array
      let fromIdx = sorted.findIndex(c => c.time >= preOpenTs)
      if (fromIdx < 0) fromIdx = Math.max(0, sorted.length - 100)

      // Set visible range so today's session fills the full chart width
      chart.timeScale().setVisibleLogicalRange({ from: fromIdx - 1, to: sorted.length - 1 + 3 })
      volChart.timeScale().setVisibleLogicalRange({ from: fromIdx - 1, to: sorted.length - 1 + 3 })

      // Draw session lines for all loaded days so scrolling shows context
      sessionBoundsRef.current = allSessionBoundaries(sorted)
      refreshSessionLines()
    } else {
      chart.timeScale().fitContent()
      volChart.timeScale().fitContent()
      sessionBoundsRef.current = []
      setSessionLines([])
    }
  }, [candles, mode, loading, error, rangeKey, refreshSessionLines])

  // ── Live price polling ────────────────────────────────────────────────────

  useEffect(() => {
    if (!priceSeriesRef.current || candles.length === 0) return
    const id = setInterval(async () => {
      try {
        const q = await getStockQuote({ data: symbol })
        if (!q || !priceSeriesRef.current) return
        try { priceSeriesRef.current.update({ time: q.timestamp as any, value: q.price }) } catch {}
        const now = new Date()
        const total = now.getUTCHours() * 60 + now.getUTCMinutes() - 5 * 60 // rough ET offset
        setIsExtendedHours(!(total >= 570 && total < 960) && total >= 240 && total < 1200)
      } catch {}
    }, 10_000)
    return () => clearInterval(id)
  }, [symbol, candles.length])

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="card p-0 overflow-hidden">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b" style={{ borderColor: COLORS.border }}>
        <div className="flex gap-0.5 items-center">
          {RANGES.map(({ key }) => (
            <button key={key} onClick={() => setRangeKey(key)}
              className="px-2 py-1 text-xs font-medium rounded transition-colors"
              style={rangeKey === key ? { background: COLORS.primary, color: '#fff' } : { color: COLORS.text, background: 'transparent' }}
            >{key}</button>
          ))}
          {isExtendedHours && rangeKey === '1D' && (
            <span style={{ color: '#d97706', fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: 'rgba(217,119,6,0.1)', border: '1px solid rgba(217,119,6,0.3)' }}>
              Extended Hours
            </span>
          )}
        </div>
        <div className="flex gap-0.5">
          {MODES.map(m => (
            <button key={m} onClick={() => setMode(m)}
              className="px-2 py-1 text-xs font-medium rounded transition-colors"
              style={mode === m ? { background: COLORS.primary, color: '#fff' } : { color: COLORS.text, background: 'transparent' }}
            >{m}</button>
          ))}
        </div>
      </div>

      {/* Chart area */}
      <div className="relative">
        {loading && <div className="animate-pulse" style={{ height: 352, background: '#f3f4f6' }} />}
        {!loading && error && (
          <div className="flex items-center justify-center" style={{ height: 352, color: COLORS.down }}>
            <p className="text-sm">Failed to load chart data.</p>
          </div>
        )}
        {!loading && !error && candles.length === 0 && (
          <div className="flex items-center justify-center" style={{ height: 352 }}>
            <p className="text-sm" style={{ color: '#6b7280' }}>No chart data available for this range.</p>
          </div>
        )}

        <div style={{ display: loading || error || candles.length === 0 ? 'none' : 'block' }}>
          {/* Price chart with session line overlays */}
          <div style={{ position: 'relative' }}>
            <div ref={priceRef} />
            {sessionLines.map((line, i) => (
              <div key={i} style={{
                position: 'absolute', top: 0, bottom: 0, left: line.x, width: 1,
                background: line.dash
                  ? `repeating-linear-gradient(to bottom,${line.color} 0px,${line.color} 4px,transparent 4px,transparent 8px)`
                  : line.color,
                pointerEvents: 'none', zIndex: 2,
              }}>
                <span style={{ position: 'absolute', top: 4, left: 3, fontSize: 9, fontWeight: 600, color: line.color, whiteSpace: 'nowrap', lineHeight: 1, pointerEvents: 'none' }}>
                  {line.label}
                </span>
              </div>
            ))}
          </div>
          <div ref={volumeRef} style={{ borderTop: `1px solid ${COLORS.border}` }} />
        </div>
      </div>
    </div>
  )
}
