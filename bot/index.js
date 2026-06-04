#!/usr/bin/env node
// Nexus Trader — autonomous server-side bot
// Runs via GitHub Actions cron every 30 minutes.
// Reads/writes portfolio.json in the repo root.

import fs from "fs";

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const FINNHUB_KEY    = process.env.FINNHUB_KEY;
const MODEL          = "claude-sonnet-4-6";
const PORTFOLIO_FILE = "portfolio.json";
const NOW_ISO        = new Date().toISOString();

const WATCHLIST = [
  { symbol: "AAPL",    market: "Stocks", volatility: "Low"    },
  { symbol: "MSFT",    market: "Stocks", volatility: "Low"    },
  { symbol: "GOOGL",   market: "Stocks", volatility: "Low"    },
  { symbol: "META",    market: "Stocks", volatility: "Medium" },
  { symbol: "AMZN",    market: "Stocks", volatility: "Medium" },
  { symbol: "NVDA",    market: "Stocks", volatility: "Medium" },
  { symbol: "AMD",     market: "Stocks", volatility: "High"   },
  { symbol: "TSLA",    market: "Stocks", volatility: "High"   },
  { symbol: "NFLX",    market: "Stocks", volatility: "High"   },
  { symbol: "JPM",     market: "Stocks", volatility: "Low"    },
  { symbol: "LLY",     market: "Stocks", volatility: "Medium" },
  { symbol: "SPY",     market: "Stocks", volatility: "Low"    },
  { symbol: "BTC/USD", market: "Crypto", volatility: "High"   },
  { symbol: "ETH/USD", market: "Crypto", volatility: "High"   },
  { symbol: "SOL/USD", market: "Crypto", volatility: "High"   },
];

const RISK_TIERS = {
  low:    { sl: 0.02, tp: 0.05, maxOpen: 4, minConsensus: 75 },
  medium: { sl: 0.04, tp: 0.12, maxOpen: 3, minConsensus: 60 },
  high:   { sl: 0.07, tp: 0.25, maxOpen: 2, minConsensus: 45 },
};

const CORRELATED_GROUPS = [
  ["BTC/USD", "ETH/USD", "SOL/USD"],
  ["AAPL", "MSFT", "GOOGL"],
  ["META", "GOOGL"],
  ["NVDA", "AMD"],
  ["NVDA", "AMZN"],
];

const MOCK_NEWS = {
  AAPL: 65, MSFT: 70, GOOGL: 72, META: 75, AMZN: 72,
  NVDA: 88, AMD: 65, TSLA: 25, NFLX: 68, JPM: 60,
  LLY: 80, SPY: 65, "BTC/USD": 82, "ETH/USD": 68, "SOL/USD": 74,
};
const MOCK_SOCIAL = {
  AAPL: 61, MSFT: 66, GOOGL: 70, META: 78, AMZN: 74,
  NVDA: 91, AMD: 68, TSLA: 32, NFLX: 72, JPM: 55,
  LLY: 75, SPY: 60, "BTC/USD": 84, "ETH/USD": 67, "SOL/USD": 80,
};

const DAILY_LOSS_LIMIT = 0.05;
const COOLDOWN_MS      = 15 * 60 * 1000;

// ── HELPERS ───────────────────────────────────────────────────────────────────

const log    = (...a) => console.log(`[${NOW_ISO}]`, ...a);
const fmtUSD = (n)   => "$" + Number(n).toFixed(2);
const toYahoo = (s)  => s.replace("/", "-");

function stockMarketOpen() {
  const et   = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day  = et.getDay();
  const mins = et.getHours() * 60 + et.getMinutes();
  return day >= 1 && day <= 5 && mins >= 570 && mins < 960;
}

// ── PORTFOLIO ─────────────────────────────────────────────────────────────────

function loadPortfolio() {
  try {
    if (fs.existsSync(PORTFOLIO_FILE))
      return JSON.parse(fs.readFileSync(PORTFOLIO_FILE, "utf8"));
  } catch (e) { log("Portfolio load error:", e.message); }
  return { cash: 100000, positions: [], orders: [], cooldowns: {}, lastRun: null, haltReason: null };
}

function savePortfolio(p) {
  fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(p, null, 2));
  log("portfolio.json saved.");
}

// ── MARKET DATA ───────────────────────────────────────────────────────────────
// Finnhub.io — free stock data (60 calls/min), requires FINNHUB_KEY secret
// CoinGecko  — free crypto data, no API key needed

const COINGECKO_IDS = { "BTC/USD": "bitcoin", "ETH/USD": "ethereum", "SOL/USD": "solana" };

async function fetchStockQuote(symbol) {
  if (!FINNHUB_KEY) return null;
  const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`);
  if (!res.ok) return null;
  const d = await res.json();
  if (!d.c) return null;
  return { price: d.c, change: +d.dp.toFixed(2) };
}

async function fetchStockCloses(symbol) {
  if (!FINNHUB_KEY) return null;
  const to   = Math.floor(Date.now() / 1000);
  const from = to - 120 * 24 * 60 * 60;
  const res  = await fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_KEY}`);
  if (!res.ok) return null;
  const d = await res.json();
  return d.s === "ok" ? d.c : null;
}

async function fetchCryptoQuote(symbol) {
  const id  = COINGECKO_IDS[symbol];
  if (!id) return null;
  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`);
  if (!res.ok) return null;
  const data = await res.json();
  const price = data[id]?.usd;
  if (!price) return null;
  return { price, change: +(data[id].usd_24h_change ?? 0).toFixed(2) };
}

async function fetchCryptoCloses(symbol) {
  const id  = COINGECKO_IDS[symbol];
  if (!id) return null;
  const res = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=90&interval=daily`);
  if (!res.ok) return null;
  const data = await res.json();
  return (data.prices ?? []).map(([, p]) => p);
}

async function fetchPrices(symbols) {
  const out = {};
  await Promise.all(symbols.map(async sym => {
    try {
      const q = sym.includes("/") ? await fetchCryptoQuote(sym) : await fetchStockQuote(sym);
      if (q) out[sym] = q;
    } catch (e) { log(`fetchPrices ${sym}:`, e.message); }
  }));
  return out;
}

async function fetchCloses(symbol) {
  try {
    return symbol.includes("/") ? await fetchCryptoCloses(symbol) : await fetchStockCloses(symbol);
  } catch (e) { log(`fetchCloses ${symbol}:`, e.message); return null; }
}

// ── TECHNICALS ────────────────────────────────────────────────────────────────

function calcRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  const avgLoss = losses / period;
  return avgLoss === 0 ? 100 : Math.round(100 - 100 / (1 + (gains / period) / avgLoss));
}

function ema(closes, period) {
  const k = 2 / (period + 1);
  let val = closes[0];
  for (let i = 1; i < closes.length; i++) val = closes[i] * k + val * (1 - k);
  return val;
}

function calcMACD(closes) {
  if (!closes || closes.length < 26) return "Neutral";
  const pct = (ema(closes, 12) - ema(closes, 26)) / closes[closes.length - 1];
  return pct > 0.005 ? "Bullish" : pct < -0.005 ? "Bearish" : "Neutral";
}

function calcTechScore(rsi, macd) {
  let s = 50;
  if      (rsi <= 30) s += 20;
  else if (rsi <= 40) s += 12;
  else if (rsi <= 50) s += 4;
  else if (rsi <= 60) s -= 4;
  else if (rsi <= 70) s -= 12;
  else                s -= 20;
  if      (macd === "Bullish") s += 15;
  else if (macd === "Bearish") s -= 15;
  return Math.min(100, Math.max(0, Math.round(s)));
}

// ── SIGNAL ENGINE ─────────────────────────────────────────────────────────────

function assignTier(consensus, volatility) {
  if (consensus >= 75 && volatility !== "High") return "low";
  if (consensus >= 75)  return "medium";
  if (consensus >= 60)  return "medium";
  if (consensus >= 45)  return "high";
  return null;
}

function isCorrelated(symbol, positions) {
  for (const g of CORRELATED_GROUPS)
    if (g.includes(symbol) && positions.some(p => g.includes(p.symbol) && p.symbol !== symbol))
      return true;
  return false;
}

// ── CLAUDE ────────────────────────────────────────────────────────────────────

async function callClaude(system, userContent) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL, max_tokens: 500, system,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  const text = data.content?.find(b => b.type === "text")?.text ?? "";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  log("=== Nexus Trader Bot starting ===");

  if (!ANTHROPIC_KEY) { log("ERROR: ANTHROPIC_API_KEY secret not set"); process.exit(1); }
  if (!FINNHUB_KEY)   { log("ERROR: FINNHUB_KEY secret not set"); process.exit(1); }

  const portfolio = loadPortfolio();
  portfolio.cooldowns = portfolio.cooldowns ?? {};

  // Expire cooldowns
  const now = Date.now();
  for (const sym of Object.keys(portfolio.cooldowns))
    if (now - portfolio.cooldowns[sym] > COOLDOWN_MS) delete portfolio.cooldowns[sym];

  log(`Cash: ${fmtUSD(portfolio.cash)} | Positions: ${portfolio.positions.length}`);

  // Fetch live prices
  const prices = await fetchPrices(WATCHLIST.map(w => w.symbol));
  log(`Prices loaded: ${Object.keys(prices).length}/${WATCHLIST.length} symbols`);
  if (Object.keys(prices).length < 3) {
    log("ERROR: Too few prices returned — skipping cycle to avoid bad trades.");
    savePortfolio({ ...portfolio, lastRun: NOW_ISO });
    return;
  }

  // Portfolio metrics
  const totalPosValue = portfolio.positions.reduce((s, p) => s + p.qty * (prices[p.symbol]?.price ?? p.avgEntry), 0);
  const equity        = portfolio.cash + totalPosValue;
  const unrealizedPL  = portfolio.positions.reduce((s, p) => {
    const cur = prices[p.symbol]?.price ?? p.avgEntry;
    return s + p.qty * (cur - p.avgEntry);
  }, 0);

  log(`Equity: ${fmtUSD(equity)} | Unrealized P&L: ${fmtUSD(unrealizedPL)}`);

  // Drawdown halt check
  if (equity > 0 && unrealizedPL / equity < -DAILY_LOSS_LIMIT) {
    log(`HALT: Daily loss limit exceeded (${(unrealizedPL/equity*100).toFixed(1)}%)`);
    savePortfolio({ ...portfolio, haltReason: "drawdown_limit", lastRun: NOW_ISO });
    return;
  }

  // ── 1. Stop-loss / take-profit ────────────────────────────────────────────

  const toClose = [];
  for (const pos of portfolio.positions) {
    const cur    = prices[pos.symbol]?.price;
    if (!cur) continue;
    const pnlPct  = (cur - pos.avgEntry) / pos.avgEntry;
    const tierCfg = RISK_TIERS[pos.tier ?? "medium"];
    if (pnlPct <= -tierCfg.sl) {
      log(`🛑 STOP LOSS: ${pos.symbol} ${(pnlPct*100).toFixed(1)}%`);
      toClose.push({ pos, price: cur, reason: "stop_loss" });
    } else if (pnlPct >= tierCfg.tp) {
      log(`🎯 TAKE PROFIT: ${pos.symbol} +${(pnlPct*100).toFixed(1)}%`);
      toClose.push({ pos, price: cur, reason: "take_profit" });
    }
  }

  for (const { pos, price, reason } of toClose) {
    const pnl = pos.qty * (price - pos.avgEntry);
    portfolio.cash      += pos.qty * price;
    portfolio.positions  = portfolio.positions.filter(p => p.symbol !== pos.symbol);
    portfolio.orders     = [
      { id: now.toString(36), symbol: pos.symbol, side: "sell", qty: String(pos.qty),
        filled_avg_price: price.toFixed(2), limit_price: null, type: "market",
        status: "filled", reason, pnl: pnl.toFixed(2), created_at: NOW_ISO },
      ...portfolio.orders,
    ].slice(0, 200);
    log(`Closed ${pos.symbol}: P&L ${pnl >= 0 ? "+" : ""}${fmtUSD(pnl)} [${reason}]`);
  }

  // ── 2. Fetch technicals ───────────────────────────────────────────────────

  log("Fetching technicals...");
  const technicals = {};
  await Promise.all(WATCHLIST.map(async ({ symbol }) => {
    const closes = await fetchCloses(symbol);
    if (!closes || closes.length < 15) return;
    const rsi  = calcRSI(closes);
    const macd = calcMACD(closes);
    technicals[symbol] = { rsi, macd, score: calcTechScore(rsi, macd) };
  }));
  log(`Technicals: ${Object.keys(technicals).length} symbols`);

  // ── 3. Build signals ──────────────────────────────────────────────────────

  const isMarketOpen = stockMarketOpen();
  log(`NYSE/NASDAQ: ${isMarketOpen ? "OPEN" : "CLOSED"} | Crypto: always open`);

  const signals = WATCHLIST.map(asset => {
    const tech  = technicals[asset.symbol]?.score ?? 50;
    const news  = MOCK_NEWS[asset.symbol]          ?? 50;
    const soc   = MOCK_SOCIAL[asset.symbol]        ?? 50;
    const cons  = Math.round(tech * 0.5 + news * 0.3 + soc * 0.2);
    const tier  = assignTier(cons, asset.volatility);
    const action = cons >= 62 ? "BUY" : cons <= 42 ? "SELL" : "HOLD";
    const votes  = [tech >= 62, news >= 62, soc >= 62].filter(Boolean).length;
    return { ...asset, tech, news, social: soc, consensus: cons, tier, action, votes,
             rsi: technicals[asset.symbol]?.rsi, macd: technicals[asset.symbol]?.macd,
             price: prices[asset.symbol]?.price };
  });

  // ── 4. Filter candidates ──────────────────────────────────────────────────

  const candidates = signals.filter(s => {
    if (!s.tier || s.action === "HOLD") return false;
    if (s.market === "Stocks" && !isMarketOpen) { log(`⭕ ${s.symbol} — market closed`); return false; }
    if (s.votes < 2)                            { log(`⭕ ${s.symbol} — ${s.votes}/3 agree`); return false; }
    if (portfolio.cooldowns[s.symbol])           { log(`⭕ ${s.symbol} — cooldown`); return false; }
    if (isCorrelated(s.symbol, portfolio.positions)) { log(`⭕ ${s.symbol} — correlated`); return false; }
    const tierOpen = portfolio.positions.filter(p => p.tier === s.tier).length;
    if (tierOpen >= RISK_TIERS[s.tier].maxOpen)  { log(`⭕ ${s.symbol} — tier full`); return false; }
    return true;
  }).sort((a, b) => b.consensus - a.consensus);

  if (!candidates.length) {
    log("No qualifying candidates — saving and exiting.");
    savePortfolio({ ...portfolio, lastRun: NOW_ISO });
    return;
  }

  log(`Candidates: ${candidates.map(c => `${c.symbol}(${c.consensus}%)`).join(", ")}`);

  // ── 5. Claude trade decision ──────────────────────────────────────────────

  let decision;
  try {
    decision = await callClaude(
      `You are an elite low-risk-first trading AI. Pick the single best trade. Return ONLY JSON: {"symbol":"...","action":"buy|sell","tier":"low|medium|high","qty":1,"reasoning":"1 sentence"}. qty must be a positive integer (shares for stocks, fractional ok for crypto). Never exceed $500 per trade.`,
      `Available cash: ${fmtUSD(portfolio.cash)}\nCandidates:\n${candidates.map(c =>
        `${c.symbol} | ${c.action} | Consensus:${c.consensus}% | Tier:${c.tier} | Price:$${c.price} | RSI:${c.rsi} | MACD:${c.macd} | Votes:${c.votes}/3`
      ).join("\n")}\nPick the best single trade. Keep position size modest (max $500).`
    );
    log(`Claude: ${decision.action?.toUpperCase()} ${decision.symbol} x${decision.qty}`);
    log(`Reasoning: ${decision.reasoning}`);
  } catch (e) {
    log("Claude failed:", e.message);
    savePortfolio({ ...portfolio, lastRun: NOW_ISO });
    return;
  }

  if (!decision?.symbol || !decision?.action) {
    log("Invalid decision — skipping.");
    savePortfolio({ ...portfolio, lastRun: NOW_ISO });
    return;
  }

  // ── 6. Kelly position sizing ──────────────────────────────────────────────

  const price    = prices[decision.symbol]?.price ?? 100;
  const sig      = candidates.find(c => c.symbol === decision.symbol) ?? candidates[0];
  const tier     = sig?.tier ?? "medium";
  const tierCfg  = RISK_TIERS[tier];
  const b        = 0.06 / 0.04;
  const kelly    = Math.max(0, (b * 0.5 - 0.5) / b);
  const kellyCap = Math.max(10, Math.min(equity * kelly * 0.5, equity * 0.15));

  // Hard cap at $500 per trade regardless of Kelly.
  // Scale Claude's qty down proportionally if it exceeds the budget —
  // this handles expensive assets (BTC $97k, NFLX $1200+) without forcing 1 full unit.
  const maxBudget  = Math.min(kellyCap, 500);
  const claudeQty  = parseFloat(decision.qty) || 1;
  const safeQty    = claudeQty * price <= maxBudget
    ? claudeQty
    : +(maxBudget / price).toFixed(price >= 1000 ? 6 : price >= 100 ? 4 : 2);

  // ── 7. Execute trade ──────────────────────────────────────────────────────

  if (decision.action === "buy") {
    const cost = safeQty * price;
    if (portfolio.cash < cost) {
      log(`Insufficient funds (need ${fmtUSD(cost)}, have ${fmtUSD(portfolio.cash)})`);
      savePortfolio({ ...portfolio, lastRun: NOW_ISO });
      return;
    }
    portfolio.cash -= cost;
    const idx = portfolio.positions.findIndex(p => p.symbol === decision.symbol);
    if (idx >= 0) {
      const ex = portfolio.positions[idx];
      const totalQty = ex.qty + safeQty;
      portfolio.positions[idx] = { ...ex, qty: totalQty, avgEntry: (ex.qty * ex.avgEntry + safeQty * price) / totalQty };
    } else {
      portfolio.positions.push({
        symbol: decision.symbol, qty: safeQty, avgEntry: price, tier,
        instrumentType: decision.symbol.includes("/") ? "Cryptocurrency" : "Equity",
        openedAt: now,
      });
    }
    log(`✅ BUY ${safeQty} ${decision.symbol} @ ${fmtUSD(price)} | SL:${fmtUSD(price*(1-tierCfg.sl))} TP:${fmtUSD(price*(1+tierCfg.tp))}`);
  } else {
    const idx = portfolio.positions.findIndex(p => p.symbol === decision.symbol);
    if (idx >= 0) {
      const ex = portfolio.positions[idx];
      const sellQty = Math.min(safeQty, ex.qty);
      portfolio.cash += sellQty * price;
      if (ex.qty - sellQty <= 0) portfolio.positions.splice(idx, 1);
      else portfolio.positions[idx] = { ...ex, qty: ex.qty - sellQty };
    }
    log(`✅ SELL ${safeQty} ${decision.symbol} @ ${fmtUSD(price)}`);
  }

  portfolio.orders = [
    { id: now.toString(36), symbol: decision.symbol, side: decision.action, qty: String(safeQty),
      filled_avg_price: price.toFixed(2), limit_price: null, type: "market", status: "filled",
      tier, reasoning: decision.reasoning, created_at: NOW_ISO },
    ...portfolio.orders,
  ].slice(0, 200);

  portfolio.cooldowns[decision.symbol] = now;
  portfolio.lastRun  = NOW_ISO;
  portfolio.haltReason = null;

  log(`Cash: ${fmtUSD(portfolio.cash)} | Positions: ${portfolio.positions.length}`);
  savePortfolio(portfolio);
  log("=== Bot cycle complete ===");
}

main().catch(e => { console.error("Bot crashed:", e); process.exit(1); });
