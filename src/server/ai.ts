import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const StockInput = z.object({
  symbol: z.string(),
  shortName: z.string(),
  price: z.number(),
  change: z.number(),
  changePct: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  previousClose: z.number(),
  volume: z.number(),
  marketCap: z.number(),
  fiftyTwoWeekHigh: z.number(),
  fiftyTwoWeekLow: z.number(),
  marketState: z.string(),
})

export type AiVerdict = {
  rating: 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell'
  summary: string
  bullets: string[]
  disclaimer: string
  error?: never
} | {
  error: 'no_key' | 'api_error'
  detail?: string
}

const GEMINI_MODELS = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro']

async function callGemini(key: string, prompt: string): Promise<string> {
  const errors: string[] = []
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      signal: AbortSignal.timeout(15000),
    })
    if (res.status === 404) {
      errors.push(`${model}=404`)
      continue
    }
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`${model} HTTP ${res.status}: ${txt.slice(0, 200)}`)
    }
    const json = await res.json()
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  }
  throw new Error(`All models 404 [${errors.join(', ')}] — Generative Language API may not be enabled in your Google Cloud project`)
}

export const getAiVerdict = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => StockInput.parse(d))
  .handler(async ({ data: s }): Promise<AiVerdict | null> => {
    const key = process.env.GEMINI_API_KEY || ''
    if (!key) return { error: 'no_key' as const }

    try {
      const pctFrom52High = s.fiftyTwoWeekHigh > 0
        ? ((s.price - s.fiftyTwoWeekHigh) / s.fiftyTwoWeekHigh) * 100 : 0
      const pctFrom52Low = s.fiftyTwoWeekLow > 0
        ? ((s.price - s.fiftyTwoWeekLow) / s.fiftyTwoWeekLow) * 100 : 0
      const intradayRange = s.low > 0 ? ((s.high - s.low) / s.low) * 100 : 0

      const prompt = `You are a concise equity analyst. Based solely on the intraday technical snapshot below, provide a short-term (1–5 day) trading verdict.

Stock: ${s.shortName} (${s.symbol})
Price: $${s.price.toFixed(2)} (${s.change >= 0 ? '+' : ''}${s.changePct.toFixed(2)}% today)
Open: $${s.open.toFixed(2)} | High: $${s.high.toFixed(2)} | Low: $${s.low.toFixed(2)}
Prev Close: $${s.previousClose.toFixed(2)}
Intraday range: ${intradayRange.toFixed(1)}%
52W High: $${s.fiftyTwoWeekHigh.toFixed(2)} (${pctFrom52High.toFixed(1)}% from high)
52W Low: $${s.fiftyTwoWeekLow.toFixed(2)} (+${pctFrom52Low.toFixed(1)}% from low)
Market Cap: ${s.marketCap > 0 ? '$' + (s.marketCap / 1e9).toFixed(1) + 'B' : 'N/A'}
Market State: ${s.marketState}

Respond with ONLY valid JSON, no markdown fences:
{
  "rating": "<Strong Buy|Buy|Hold|Sell|Strong Sell>",
  "summary": "<one sentence, ≤20 words>",
  "bullets": ["<reason 1>", "<reason 2>", "<reason 3>"]
}

Base bullets on: price vs open, intraday range, proximity to 52W extremes, and day's momentum. Be direct and specific.`

      const text = await callGemini(key, prompt)
      const parsed = JSON.parse(text.trim().replace(/^```json\n?|\n?```$/g, ''))

      return {
        rating: parsed.rating,
        summary: parsed.summary,
        bullets: parsed.bullets,
        disclaimer: 'AI analysis is for informational purposes only, not financial advice.',
      }
    } catch (e: any) {
      return { error: 'api_error' as const, detail: String(e?.message ?? e) }
    }
  })
