import { YAHOO_BASE } from "../constants.js";

// Yahoo Finance uses BTC-USD format; our watchlist uses BTC/USD
const toYahoo = (sym) => sym.replace("/", "-");

// ── REAL-TIME QUOTES ──────────────────────────────────────────────────────────
// Returns { symbol: { price, change, volume, marketCap, pe, high52w, low52w, analystRating } }

export async function fetchQuotes(symbols) {
  const yahooSyms = symbols.map(toYahoo).join(",");
  try {
    const res  = await fetch(`${YAHOO_BASE}/v7/finance/quote?symbols=${yahooSyms}`);
    if (!res.ok) return {};
    const data = await res.json();
    const out  = {};
    for (const q of data.quoteResponse?.result ?? []) {
      const sym = symbols.find((s) => toYahoo(s) === q.symbol) ?? q.symbol;
      out[sym] = {
        price:         q.regularMarketPrice           ?? 0,
        change:        +(q.regularMarketChangePercent ?? 0).toFixed(2),
        volume:        q.regularMarketVolume          ?? 0,
        marketCap:     q.marketCap                    ?? null,
        pe:            q.trailingPE                   ?? null,
        high52w:       q.fiftyTwoWeekHigh             ?? null,
        low52w:        q.fiftyTwoWeekLow              ?? null,
        analystRating: q.averageAnalystRating         ?? null,
      };
    }
    return out;
  } catch {
    return {};
  }
}

// ── HISTORICAL DAILY CLOSES (90 days) ─────────────────────────────────────────
// Returns number[] of closing prices, oldest first

export async function fetchCloses(symbol) {
  try {
    const res  = await fetch(`${YAHOO_BASE}/v8/finance/chart/${toYahoo(symbol)}?interval=1d&range=3mo`);
    if (!res.ok) return null;
    const data = await res.json();
    const raw  = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    return raw.filter((c) => c != null);
  } catch {
    return null;
  }
}

// ── TECHNICAL INDICATORS ──────────────────────────────────────────────────────

export function calcRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return Math.round(100 - 100 / (1 + avgGain / avgLoss));
}

function ema(closes, period) {
  const k = 2 / (period + 1);
  let val  = closes[0];
  for (let i = 1; i < closes.length; i++) val = closes[i] * k + val * (1 - k);
  return val;
}

export function calcMACD(closes) {
  if (!closes || closes.length < 26) return "Neutral";
  const macdLine   = ema(closes, 12) - ema(closes, 26);
  const lastPrice  = closes[closes.length - 1];
  const pct        = lastPrice > 0 ? macdLine / lastPrice : 0;
  if (pct >  0.005) return "Bullish";
  if (pct < -0.005) return "Bearish";
  return "Neutral";
}

export function calcTechScore(rsi, macd) {
  let score = 50;
  if      (rsi <= 30) score += 20;
  else if (rsi <= 40) score += 12;
  else if (rsi <= 50) score +=  4;
  else if (rsi <= 60) score -=  4;
  else if (rsi <= 70) score -= 12;
  else                score -= 20;
  if      (macd === "Bullish") score += 15;
  else if (macd === "Bearish") score -= 15;
  return Math.min(100, Math.max(0, Math.round(score)));
}

// Fetch closes + calculate indicators for all symbols in parallel
export async function fetchAllTechnicals(symbols) {
  const entries = await Promise.all(
    symbols.map(async (sym) => {
      const closes = await fetchCloses(sym);
      if (!closes || closes.length < 15) return [sym, null]; // not enough data
      const rsi   = calcRSI(closes);
      const macd  = calcMACD(closes);
      const score = calcTechScore(rsi, macd);
      return [sym, { rsi, macd, score }];
    })
  );
  const result = {};
  for (const [sym, val] of entries) if (val) result[sym] = val;
  return result;
}

// ── NEWS HEADLINES ────────────────────────────────────────────────────────────
// Returns [{ title, publisher, time }] for a single symbol

export async function fetchNewsHeadlines(symbol) {
  try {
    const res  = await fetch(
      `${YAHOO_BASE}/v1/finance/search?q=${toYahoo(symbol)}&newsCount=5&quotesCount=0&enableFuzzyQuery=false`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.news ?? []).slice(0, 5).map((n) => ({
      title:     n.title,
      publisher: n.publisher,
      time:      n.providerPublishTime,
    }));
  } catch {
    return [];
  }
}

// Fetch news headlines for all symbols in parallel
export async function fetchAllNews(symbols) {
  const entries = await Promise.all(
    symbols.map(async (sym) => [sym, await fetchNewsHeadlines(sym)])
  );
  return Object.fromEntries(entries);
}
