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

const SESSION_LINES = [
  { hh: 4,  mm: 0,  label: 'Pre',   color: 'rgba(217,119,6,0.65)',   dash: true  },
  { hh: 9,  mm: 30, label: 'Open',  color: 'rgba(0,135,60,0.85)',    dash: false },
  { hh: 16, mm: 0,  label: 'Close', color: 'rgba(235,15,41,0.85)',   dash: false },
  { hh: 20, mm: 0,  label: 'AH',    color: 'rgba(217,119,6,0.65)',   dash: true  },
]

type RangeKey = '1D' | '5D' | '1M' | '6M' | 'YTD' | '1Y' | '5Y' | 'Max'
type ModeKey = 'Area' | 'Candlestick' | 'Line' | 'Baseline'

const RANGES: { key: RangeKey; range: string; interval: string }[] = [
  { key: '1D',  range: '1d',   interval: '5m'  },
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

// ─── Helper: compute ET session boundary timestamps from any intraday ts ──────

function getSessionBoundaryTs(anyTs: number): { time: number; label: string; color: string; dash: boolean }[] {
  const d = new Date(anyTs * 1000)
  // Get "wall clock" NY time as a JS Date (UTC values = NY local values)
  const nyWall = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  // UTC offset: positive = NY is behind UTC
  const utcOffsetMs = d.getTime() - nyWall.getTime()
  // Midnight in NY wall time
  nyWall.setHours(0, 0, 0, 0)
  return SESSION_LINES.map(({ hh, mm, label, color, dash }) => {
    const nyBoundary = new Date(nyWall)
    nyBoundary.setHours(hh, mm, 0, 0)
    return { time: Math.floor((nyBoundary.getTime() + utcOffsetMs) / 1000), label, color, dash }
  })
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
  const sessionBoundsRef = useRef<{ time: number; label: string; color: string; dash: boolean }[]>([])

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

  // ── Recompute session line x-positions ────────────────────────────────────

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

    const chartOptions = {
      layout: { background: { color: COLORS.background }, textColor: COLORS.text },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      crosshair: { mode: 1 as const },
      rightPriceScale: { borderColor: COLORS.border },
      timeScale: { borderColor: COLORS.border, timeVisible: true, secondsVisible: false, visible: true },
      handleScroll: true,
      handleScale: true,
    }

    const priceChart = createChart(priceRef.current, { ...chartOptions, height: 280 })
    const volChart = createChart(volumeRef.current, {
      ...chartOptions,
      height: 70,
      timeScale: { visible: false },
      rightPriceScale: { borderColor: COLORS.border, scaleMargins: { top: 0.1, bottom: 0 } },
    })

    chartRef.current = priceChart
    volChartRef.current = volChart

    // Sync crosshairs
    priceChart.subscribeCrosshairMove(param => {
      if (param.time) {
        ;(volChart as any).setCrossHairXY(param.point?.x ?? 0, 0, true)
      }
    })

    // Update session line positions on scroll/zoom
    priceChart.timeScale().subscribeVisibleLogicalRangeChange(refreshSessionLines)

    const ro = new ResizeObserver(() => {
      if (priceRef.current) priceChart.resize(priceRef.current.clientWidth, 280)
      if (volumeRef.current) volChart.resize(volumeRef.current.clientWidth, 70)
      refreshSessionLines()
    })
    if (priceRef.current) ro.observe(priceRef.current)

    return () => {
      ro.disconnect()
      priceChart.remove()
      volChart.remove()
      chartRef.current = null
      volChartRef.current = null
      priceSeriesRef.current = null
      volSeriesRef.current = null
    }
  }, [refreshSessionLines])

  // ── Update series when candles or mode change ─────────────────────────────

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

    chart.timeScale().fitContent()
    volChart.timeScale().fitContent()

    // Compute session boundary lines for 1D only
    if (rangeKey === '1D' && sorted.length > 0) {
      sessionBoundsRef.current = getSessionBoundaryTs(sorted[0].time)
      refreshSessionLines()
    } else {
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
        const hour = now.getUTCHours() - 5
        const mins = now.getUTCMinutes()
        const total = hour * 60 + mins
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
            <button
              key={key}
              onClick={() => setRangeKey(key)}
              className="px-2 py-1 text-xs font-medium rounded transition-colors"
              style={rangeKey === key ? { background: COLORS.primary, color: '#ffffff' } : { color: COLORS.text, background: 'transparent' }}
            >
              {key}
            </button>
          ))}
          {isExtendedHours && rangeKey === '1D' && (
            <span style={{ color: '#d97706', fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: 'rgba(217,119,6,0.1)', border: '1px solid rgba(217,119,6,0.3)' }}>
              Extended Hours
            </span>
          )}
        </div>
        <div className="flex gap-0.5">
          {MODES.map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="px-2 py-1 text-xs font-medium rounded transition-colors"
              style={mode === m ? { background: COLORS.primary, color: '#ffffff' } : { color: COLORS.text, background: 'transparent' }}
            >
              {m}
            </button>
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
          <div className="flex items-center justify-center" style={{ height: 352, color: COLORS.text }}>
            <p className="text-sm" style={{ color: '#6b7280' }}>No chart data available for this range.</p>
          </div>
        )}

        <div style={{ display: loading || error || candles.length === 0 ? 'none' : 'block' }}>
          {/* Price chart with session line overlays */}
          <div style={{ position: 'relative' }}>
            <div ref={priceRef} />
            {sessionLines.map((line, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: line.x,
                  width: 1,
                  background: line.dash
                    ? `repeating-linear-gradient(to bottom, ${line.color} 0px, ${line.color} 4px, transparent 4px, transparent 8px)`
                    : line.color,
                  pointerEvents: 'none',
                  zIndex: 2,
                }}
              >
                <span style={{
                  position: 'absolute',
                  top: 4,
                  left: 3,
                  fontSize: 9,
                  fontWeight: 600,
                  color: line.color,
                  whiteSpace: 'nowrap',
                  lineHeight: 1,
                  pointerEvents: 'none',
                }}>
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
