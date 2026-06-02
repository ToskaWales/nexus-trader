// In dev, proxied through Vite. In production, Yahoo Finance allows direct browser requests.
export const YAHOO_BASE = import.meta.env.PROD
  ? "https://query1.finance.yahoo.com"
  : "/yahoo";

// Starting paper balance for new portfolios
export const STARTING_BALANCE = 100_000;

export const MARKETS = ["All", "Stocks", "Crypto"];

export const WATCHLIST = [
  { symbol: "AAPL",    market: "Stocks", volatility: "Low"    },
  { symbol: "NVDA",    market: "Stocks", volatility: "Medium" },
  { symbol: "TSLA",    market: "Stocks", volatility: "High"   },
  { symbol: "MSFT",    market: "Stocks", volatility: "Low"    },
  { symbol: "AMZN",    market: "Stocks", volatility: "Medium" },
  { symbol: "BTC/USD", market: "Crypto", volatility: "High"   },
  { symbol: "ETH/USD", market: "Crypto", volatility: "High"   },
];

export const CORRELATED_GROUPS = [
  ["BTC/USD", "ETH/USD"],
  ["AAPL", "MSFT"],
  ["NVDA", "AMZN"],
];

export const SOURCE_WEIGHTS = { technical: 0.50, news: 0.30, social: 0.20 };

export const RISK_TIERS = {
  low:    { label: "LOW",  color: "#00ff9d", bg: "#00ff9d12", allocation: 0.60, minConsensus: 75, sl: 0.02, tp: 0.05, maxOpen: 3 },
  medium: { label: "MED",  color: "#f0c040", bg: "#f0c04012", allocation: 0.30, minConsensus: 60, sl: 0.04, tp: 0.12, maxOpen: 2 },
  high:   { label: "HIGH", color: "#ff4d6d", bg: "#ff4d6d12", allocation: 0.10, minConsensus: 45, sl: 0.07, tp: 0.25, maxOpen: 1 },
};

export const DAILY_LOSS_LIMIT = 0.05;
export const COOLDOWN_MS      = 15 * 60 * 1000;

export const MOCK_PRICES = {
  AAPL:      { price: 214.32,  change:  0.87  },
  NVDA:      { price: 1089.50, change:  3.21  },
  TSLA:      { price: 312.14,  change: -2.05  },
  MSFT:      { price: 422.50,  change:  0.54  },
  AMZN:      { price: 198.30,  change:  1.12  },
  "BTC/USD": { price: 97420.5, change:  2.34  },
  "ETH/USD": { price: 3812.20, change: -1.12  },
};

export const MOCK_TECH = {
  AAPL:      { rsi: 52, macd: "Neutral", score: 58 },
  NVDA:      { rsi: 62, macd: "Bullish", score: 80 },
  TSLA:      { rsi: 41, macd: "Bearish", score: 28 },
  MSFT:      { rsi: 55, macd: "Neutral", score: 60 },
  AMZN:      { rsi: 58, macd: "Bullish", score: 68 },
  "BTC/USD": { rsi: 58, macd: "Bullish", score: 72 },
  "ETH/USD": { rsi: 54, macd: "Bullish", score: 65 },
};

export const MOCK_NEWS_SCORES = {
  AAPL: 65, NVDA: 88, TSLA: 25, MSFT: 70, AMZN: 72, "BTC/USD": 82, "ETH/USD": 68,
};

export const MOCK_SOCIAL = {
  AAPL: 61, NVDA: 91, TSLA: 32, MSFT: 66, AMZN: 74, "BTC/USD": 84, "ETH/USD": 67,
};
