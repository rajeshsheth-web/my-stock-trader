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

export const getAiVerdict = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => StockInput.parse(d))
  .handler(async ({ data: s }): Promise<AiVerdict | null> => {
    const key = process.env.OPENROUTER_API_KEY || ''
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

      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://mystocktrader.vercel.app',
          'X-Title': 'MyStockTrader',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.0-flash-001',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 300,
        }),
        signal: AbortSignal.timeout(15000),
      })

      if (!res.ok) {
        const txt = await res.text()
        return { error: 'api_error' as const, detail: `HTTP ${res.status}: ${txt.slice(0, 200)}` }
      }

      const json = await res.json()
      const text = json.choices?.[0]?.message?.content?.trim() ?? ''
      const parsed = JSON.parse(text.replace(/^```json\n?|\n?```$/g, ''))

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
