// In dev, proxied through Vite. In production, Yahoo Finance allows direct browser requests.
export const YAHOO_BASE = import.meta.env.PROD
  ? "https://query1.finance.yahoo.com"
  : "/yahoo";

// Starting paper balance for new portfolios
export const STARTING_BALANCE = 100_000;

export const MARKETS = ["All", "Stocks", "Crypto"];

export const WATCHLIST = [
  // ── Tech ────────────────────────────────────────────────
  { symbol: "AAPL",    market: "Stocks", volatility: "Low"    },
  { symbol: "MSFT",    market: "Stocks", volatility: "Low"    },
  { symbol: "GOOGL",   market: "Stocks", volatility: "Low"    },
  { symbol: "META",    market: "Stocks", volatility: "Medium" },
  { symbol: "AMZN",    market: "Stocks", volatility: "Medium" },
  { symbol: "NVDA",    market: "Stocks", volatility: "Medium" },
  { symbol: "AMD",     market: "Stocks", volatility: "High"   },
  { symbol: "TSLA",    market: "Stocks", volatility: "High"   },
  // ── Consumer / Entertainment ─────────────────────────────
  { symbol: "NFLX",    market: "Stocks", volatility: "High"   },
  // ── Finance ──────────────────────────────────────────────
  { symbol: "JPM",     market: "Stocks", volatility: "Low"    },
  // ── Healthcare ───────────────────────────────────────────
  { symbol: "LLY",     market: "Stocks", volatility: "Medium" },
  // ── Broad market ─────────────────────────────────────────
  { symbol: "SPY",     market: "Stocks", volatility: "Low"    },
  // ── Crypto ───────────────────────────────────────────────
  { symbol: "BTC/USD", market: "Crypto", volatility: "High"   },
  { symbol: "ETH/USD", market: "Crypto", volatility: "High"   },
  { symbol: "SOL/USD", market: "Crypto", volatility: "High"   },
];

export const CORRELATED_GROUPS = [
  ["BTC/USD", "ETH/USD", "SOL/USD"],  // crypto moves together
  ["AAPL", "MSFT", "GOOGL"],           // mega-cap tech
  ["META", "GOOGL"],                   // ad-revenue overlap
  ["NVDA", "AMD"],                     // semiconductors
  ["NVDA", "AMZN"],                    // AI infra
];

export const SOURCE_WEIGHTS = { technical: 0.50, news: 0.30, social: 0.20 };

export const RISK_TIERS = {
  low:    { label: "LOW",  color: "#00ff9d", bg: "#00ff9d12", allocation: 0.60, minConsensus: 75, sl: 0.02, tp: 0.05, maxOpen: 4 },
  medium: { label: "MED",  color: "#f0c040", bg: "#f0c04012", allocation: 0.30, minConsensus: 60, sl: 0.04, tp: 0.12, maxOpen: 3 },
  high:   { label: "HIGH", color: "#ff4d6d", bg: "#ff4d6d12", allocation: 0.10, minConsensus: 45, sl: 0.07, tp: 0.25, maxOpen: 2 },
};

export const DAILY_LOSS_LIMIT = 0.05;
export const COOLDOWN_MS      = 15 * 60 * 1000;

export const MOCK_PRICES = {
  AAPL:      { price: 214.32,   change:  0.87  },
  MSFT:      { price: 422.50,   change:  0.54  },
  GOOGL:     { price: 178.25,   change:  0.92  },
  META:      { price: 612.40,   change:  1.45  },
  AMZN:      { price: 198.30,   change:  1.12  },
  NVDA:      { price: 135.50,   change:  3.21  },
  AMD:       { price: 162.80,   change:  2.10  },
  TSLA:      { price: 312.14,   change: -2.05  },
  NFLX:      { price: 1285.60,  change:  0.73  },
  JPM:       { price: 268.90,   change:  0.31  },
  LLY:       { price: 892.40,   change:  1.20  },
  SPY:       { price: 589.20,   change:  0.48  },
  "BTC/USD": { price: 97420.50, change:  2.34  },
  "ETH/USD": { price: 3812.20,  change: -1.12  },
  "SOL/USD": { price: 172.80,   change:  3.05  },
};

export const MOCK_TECH = {
  AAPL:      { rsi: 52, macd: "Neutral", score: 58 },
  MSFT:      { rsi: 55, macd: "Neutral", score: 60 },
  GOOGL:     { rsi: 56, macd: "Bullish", score: 67 },
  META:      { rsi: 60, macd: "Bullish", score: 74 },
  AMZN:      { rsi: 58, macd: "Bullish", score: 68 },
  NVDA:      { rsi: 62, macd: "Bullish", score: 80 },
  AMD:       { rsi: 48, macd: "Neutral", score: 52 },
  TSLA:      { rsi: 41, macd: "Bearish", score: 28 },
  NFLX:      { rsi: 63, macd: "Bullish", score: 75 },
  JPM:       { rsi: 50, macd: "Neutral", score: 55 },
  LLY:       { rsi: 65, macd: "Bullish", score: 78 },
  SPY:       { rsi: 53, macd: "Neutral", score: 58 },
  "BTC/USD": { rsi: 58, macd: "Bullish", score: 72 },
  "ETH/USD": { rsi: 54, macd: "Bullish", score: 65 },
  "SOL/USD": { rsi: 57, macd: "Bullish", score: 70 },
};

export const MOCK_NEWS_SCORES = {
  AAPL: 65, MSFT: 70, GOOGL: 72, META: 75, AMZN: 72,
  NVDA: 88, AMD: 65, TSLA: 25, NFLX: 68, JPM: 60,
  LLY: 80, SPY: 65, "BTC/USD": 82, "ETH/USD": 68, "SOL/USD": 74,
};

export const MOCK_SOCIAL = {
  AAPL: 61, MSFT: 66, GOOGL: 70, META: 78, AMZN: 74,
  NVDA: 91, AMD: 68, TSLA: 32, NFLX: 72, JPM: 55,
  LLY: 75, SPY: 60, "BTC/USD": 84, "ETH/USD": 67, "SOL/USD": 80,
};
