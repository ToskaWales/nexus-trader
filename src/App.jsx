import { useState, useEffect, useRef } from "react";
import {
  MARKETS, WATCHLIST, CORRELATED_GROUPS, SOURCE_WEIGHTS, RISK_TIERS,
  DAILY_LOSS_LIMIT, COOLDOWN_MS, MOCK_PRICES, MOCK_TECH, MOCK_NEWS_SCORES, MOCK_SOCIAL,
  STARTING_BALANCE,
} from "./constants.js";
import { claudePost }        from "./utils/claude.js";
import { kellySize }         from "./utils/kelly.js";
import { fetchQuotes, fetchAllTechnicals, fetchAllNews } from "./api/yahoo.js";

// ── PORTFOLIO HELPERS ─────────────────────────────────────────────────────────

function loadPortfolio() {
  try {
    const raw = localStorage.getItem("nexus-portfolio");
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { cash: STARTING_BALANCE, positions: [], orders: [] };
}

function savePortfolio(p) {
  try { localStorage.setItem("nexus-portfolio", JSON.stringify(p)); } catch { /* ignore */ }
}

// ── SIGNAL HELPERS ────────────────────────────────────────────────────────────

function calcConsensus(technical, news, social) {
  return Math.round(
    technical * SOURCE_WEIGHTS.technical +
    news      * SOURCE_WEIGHTS.news +
    social    * SOURCE_WEIGHTS.social
  );
}

function assignTier(consensus, volatility) {
  if (consensus >= RISK_TIERS.low.minConsensus && volatility !== "High") return "low";
  if (consensus >= RISK_TIERS.low.minConsensus)    return "medium";
  if (consensus >= RISK_TIERS.medium.minConsensus) return "medium";
  if (consensus >= RISK_TIERS.high.minConsensus)   return "high";
  return null;
}

function isCorrelated(symbol, openPositions) {
  for (const g of CORRELATED_GROUPS)
    if (g.includes(symbol) && openPositions.some((p) => g.includes(p.symbol) && p.symbol !== symbol))
      return true;
  return false;
}

function calcSharpe(returns) {
  if (returns.length < 2) return "N/A";
  const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
  const std = Math.sqrt(returns.map((r) => (r - avg) ** 2).reduce((a, b) => a + b, 0) / returns.length);
  return std === 0 ? "N/A" : (avg / std * Math.sqrt(252)).toFixed(2);
}

// ── MARKET HOURS ─────────────────────────────────────────────────────────────
// NYSE/NASDAQ: Mon–Fri 09:30–16:00 ET. Crypto: 24/7.

function stockMarketOpen() {
  const et  = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day  = et.getDay();
  const mins = et.getHours() * 60 + et.getMinutes();
  return day >= 1 && day <= 5 && mins >= 570 && mins < 960; // 9:30–16:00
}

function marketStatusText() {
  const et   = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day   = et.getDay();
  const mins  = et.getHours() * 60 + et.getMinutes();
  const isWeekend = day === 0 || day === 6;
  if (isWeekend) return { open: false, label: "WEEKEND", sub: "Crypto still active" };
  if (mins < 570) return { open: false, label: "PRE-MARKET", sub: `Opens ${Math.floor((570-mins)/60)}h ${(570-mins)%60}m` };
  if (mins < 960) return { open: true,  label: "MARKET OPEN", sub: `Closes ${Math.floor((960-mins)/60)}h ${(960-mins)%60}m` };
  return { open: false, label: "AFTER-HOURS", sub: "Opens tomorrow 9:30 ET" };
}

const delay  = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtUSD = (n) =>
  `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtNum = (n, decimals = 0) =>
  n >= 1e12 ? `${(n / 1e12).toFixed(1)}T`
  : n >= 1e9 ? `${(n / 1e9).toFixed(1)}B`
  : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M`
  : Number(n).toLocaleString(undefined, { maximumFractionDigits: decimals });

// ── UI COMPONENTS ─────────────────────────────────────────────────────────────

function Spinner({ size = 13 }) {
  return (
    <span style={{
      display: "inline-block", width: size, height: size,
      border: "2px solid #00ff9d22", borderTop: "2px solid #00ff9d",
      borderRadius: "50%", animation: "spin 0.7s linear infinite",
      verticalAlign: "middle", marginRight: 6,
    }} />
  );
}

function TierBadge({ tier }) {
  if (!tier)
    return <span style={{ fontSize: 9, color: "#3d5470", border: "1px solid #1a2535", borderRadius: 3, padding: "1px 6px" }}>SKIP</span>;
  const t = RISK_TIERS[tier];
  return (
    <span style={{ background: t.bg, color: t.color, border: `1px solid ${t.color}44`, borderRadius: 4, padding: "2px 8px", fontSize: 9, fontWeight: 800, letterSpacing: 1 }}>
      {t.label} RISK
    </span>
  );
}

function ActionBadge({ action }) {
  const cfg = { BUY: ["#00ff9d", "#00ff9d15"], SELL: ["#ff4d6d", "#ff4d6d15"], HOLD: ["#f0c040", "#f0c04015"], LONG: ["#00ff9d", "#00ff9d15"], SHORT: ["#ff4d6d", "#ff4d6d15"] };
  const [color, bg] = cfg[action] || cfg.HOLD;
  return <span style={{ background: bg, color, border: `1px solid ${color}44`, borderRadius: 4, padding: "2px 9px", fontWeight: 800, fontSize: 10, letterSpacing: 1 }}>{action}</span>;
}

function Bar({ value, color, height = 5 }) {
  const c = color || (value >= 70 ? "#00ff9d" : value >= 50 ? "#f0c040" : "#ff4d6d");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <div style={{ flex: 1, height, background: "#1a1f2e", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, Math.max(0, value))}%`, height: "100%", background: c, borderRadius: 3, transition: "width 0.8s" }} />
      </div>
      <span style={{ color: c, fontSize: 10, fontWeight: 700, minWidth: 28 }}>{Math.round(value)}%</span>
    </div>
  );
}

function StatCard({ label, value, color = "#fff", sub }) {
  return (
    <div style={{ background: "#0d1117", border: "1px solid #1a2535", borderRadius: 8, padding: "14px 16px" }}>
      <div style={{ fontSize: 9, color: "#3d5470", letterSpacing: 1, marginBottom: 5 }}>{label}</div>
      <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 17, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: "#3d5470", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Input({ label, value, onChange, type = "text", placeholder }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: "#3d5470", marginBottom: 5, letterSpacing: 1 }}>{label}</div>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", background: "#080b14", border: "1px solid #1a2535", borderRadius: 6, padding: "10px 14px", color: "#c9d1e0", fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, outline: "none", boxSizing: "border-box" }}
      />
    </div>
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

export default function App() {
  // Auth — only need Anthropic key; no broker account
  const [anthropicKey, setAnthropicKey] = useState(() => localStorage.getItem("nexus-anthropic-key") ?? "");
  const [connected,    setConnected]    = useState(false);
  const [connecting,   setConnecting]   = useState(false);
  const [authError,    setAuthError]    = useState("");

  // Local paper portfolio (persisted in localStorage)
  const [portfolio,    setPortfolio]    = useState(loadPortfolio);
  const portfolioRef   = useRef(portfolio);
  useEffect(() => { portfolioRef.current = portfolio; savePortfolio(portfolio); }, [portfolio]);

  // Market data
  const [prices,       setPrices]       = useState(MOCK_PRICES);
  const [quoteData,    setQuoteData]    = useState({});          // richer quote fields
  const [technicals,   setTechnicals]   = useState(MOCK_TECH);  // { sym: { rsi, macd, score } }
  const [newsScores,   setNewsScores]   = useState(MOCK_NEWS_SCORES);
  const [newsCache,    setNewsCache]    = useState({});

  // Bot state
  const [activeMarket, setActiveMarket] = useState("All");
  const [activeTab,    setActiveTab]    = useState("signals");
  const [signals,      setSignals]      = useState([]);
  const [log,          setLog]          = useState([]);
  const [running,      setRunning]      = useState(false);
  const [botStatus,    setBotStatus]    = useState("idle");
  const [cooldowns,    setCooldowns]    = useState({});
  const [refreshing,   setRefreshing]   = useState(false);
  const [tokenUsed,    setTokenUsed]    = useState(0);

  // Auto-run
  const [autoMode,      setAutoMode]      = useState(false);
  const [cycleInterval, setCycleInterval] = useState(30);   // minutes between cycles
  const [countdown,     setCountdown]     = useState("");

  const signalsRef     = useRef([]);
  const logRef         = useRef(null);
  const runningRef     = useRef(false);
  const runBotCycleRef = useRef(null); // always points to latest runBotCycle closure

  useEffect(() => { signalsRef.current = signals; }, [signals]);
  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  // Expire cooldowns every 60s
  useEffect(() => {
    const id = setInterval(() => {
      setCooldowns((prev) => {
        const now = Date.now(), next = {};
        for (const [sym, ts] of Object.entries(prev)) if (now - ts < COOLDOWN_MS) next[sym] = ts;
        return next;
      });
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const addLog = (msg) => setLog((prev) => [...prev, { time: new Date().toLocaleTimeString(), msg }]);

  // ── AUTO-RUN ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!autoMode || !connected) { setCountdown(""); return; }
    const ms       = cycleInterval * 60_000;
    let nextAt     = Date.now() + ms;

    // Countdown ticker (updates every second)
    const tickId = setInterval(() => {
      const diff = Math.max(0, nextAt - Date.now());
      const m = Math.floor(diff / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setCountdown(`${m}:${String(s).padStart(2, "0")}`);
    }, 1_000);

    // Bot cycle scheduler
    const cycleId = setInterval(() => {
      nextAt = Date.now() + ms;
      if (runningRef.current) return;
      const status = marketStatusText();
      // Always run for crypto; only run for stocks during market hours
      if (status.open || activeMarket === "Crypto") {
        addLog(`⏰ Auto-run (every ${cycleInterval}m) — ${status.label}`);
        runBotCycleRef.current?.();
      } else {
        addLog(`⏸ Auto-run skipped — ${status.label} (${status.sub})`);
      }
    }, ms);

    return () => { clearInterval(tickId); clearInterval(cycleId); setCountdown(""); };
  }, [autoMode, connected, cycleInterval, activeMarket]); // eslint-disable-line

  // ── CONNECT ───────────────────────────────────────────────────────────────

  async function connect() {
    if (!anthropicKey) { setAuthError("Anthropic API key is required."); return; }
    setConnecting(true);
    setAuthError("");
    try {
      // Validate key with a minimal test call
      await claudePost(anthropicKey, { system: "Reply: OK", userContent: "ping", maxTokens: 5 });
      localStorage.setItem("nexus-anthropic-key", anthropicKey);
    } catch (e) {
      setAuthError(`Invalid key: ${e.message}`);
      setConnecting(false);
      return;
    }
    setConnected(true);
    setConnecting(false);
    // Fetch prices in background after connecting
    refreshPrices();
    // Fetch technicals in background (7 separate OHLCV calls, takes ~3-5s)
    setTimeout(() => refreshTechnicals(), 500);
  }

  // ── MARKET DATA ───────────────────────────────────────────────────────────

  async function refreshPrices() {
    setRefreshing(true);
    try {
      const live = await fetchQuotes(WATCHLIST.map((w) => w.symbol));
      if (Object.keys(live).length > 0) {
        setPrices((prev) => ({ ...prev, ...live }));
        setQuoteData(live);
      }
    } catch { /* keep mock prices */ }
    setRefreshing(false);
  }

  async function refreshTechnicals() {
    addLog("📊 Fetching live RSI & MACD from Yahoo Finance...");
    try {
      const techs = await fetchAllTechnicals(WATCHLIST.map((w) => w.symbol));
      if (Object.keys(techs).length > 0) {
        setTechnicals((prev) => ({ ...prev, ...techs }));
        addLog(`📊 Technical indicators updated for ${Object.keys(techs).length} symbols.`);
      }
    } catch {
      addLog("⚠️ Could not load technicals — using mock data.");
    }
  }

  // ── SIGNAL ENGINE ─────────────────────────────────────────────────────────

  function buildSignals(overrideNews = {}, overridePrices = null, overrideTechs = null) {
    const priceData = overridePrices ?? prices;
    const techData  = overrideTechs  ?? technicals;
    const newsData  = { ...newsScores, ...overrideNews };
    const built = WATCHLIST.map((asset) => {
      const tech      = techData[asset.symbol]?.score ?? MOCK_TECH[asset.symbol]?.score ?? 50;
      const news      = newsData[asset.symbol]        ?? MOCK_NEWS_SCORES[asset.symbol] ?? 50;
      const social    = MOCK_SOCIAL[asset.symbol]     ?? 50;
      const consensus = calcConsensus(tech, news, social);
      const tier      = assignTier(consensus, asset.volatility);
      const action    = consensus >= 62 ? "BUY" : consensus <= 42 ? "SELL" : "HOLD";
      const votes     = [tech >= 62, news >= 62, social >= 62].filter(Boolean).length;
      const rsi       = techData[asset.symbol]?.rsi  ?? MOCK_TECH[asset.symbol]?.rsi;
      const macd      = techData[asset.symbol]?.macd ?? MOCK_TECH[asset.symbol]?.macd;
      const q         = priceData[asset.symbol];
      return { ...asset, tech, news, social, consensus, tier, action, votes, rsi, macd, price: q?.price, change: q?.change };
    });
    setSignals(built);
    signalsRef.current = built;
    return built;
  }

  useEffect(() => { if (connected) buildSignals(); }, [prices, technicals, newsScores, connected]); // eslint-disable-line

  // ── LOCAL PORTFOLIO EXECUTION ─────────────────────────────────────────────

  // Returns the executed order or throws on insufficient funds
  function executeOrder(symbol, qty, side, price, instrumentType) {
    const prev = portfolioRef.current;
    const cost = qty * price;

    if (side === "buy" && prev.cash < cost)
      throw new Error(`Insufficient funds — need ${fmtUSD(cost)}, have ${fmtUSD(prev.cash)}`);

    const newOrder = {
      id:               Date.now().toString(36),
      symbol,           side,
      qty:              String(qty),
      price:            price.toFixed(2),
      filled_avg_price: price.toFixed(2),
      limit_price:      null,
      type:             "market",
      status:           "filled",
      created_at:       new Date().toISOString(),
    };

    let newCash      = prev.cash;
    let newPositions = [...prev.positions];

    if (side === "buy") {
      newCash -= cost;
      const idx = newPositions.findIndex((p) => p.symbol === symbol);
      if (idx >= 0) {
        const ex      = newPositions[idx];
        const total   = ex.qty + qty;
        const avg     = (ex.qty * ex.avgEntry + qty * price) / total;
        newPositions[idx] = { ...ex, qty: total, avgEntry: avg };
      } else {
        newPositions.push({ symbol, qty, avgEntry: price, instrumentType, openedAt: Date.now() });
      }
    } else {
      const idx = newPositions.findIndex((p) => p.symbol === symbol);
      if (idx >= 0) {
        const ex      = newPositions[idx];
        const sellQty = Math.min(qty, ex.qty);
        newCash += sellQty * price;
        if (ex.qty - sellQty <= 0)
          newPositions = newPositions.filter((_, i) => i !== idx);
        else
          newPositions[idx] = { ...ex, qty: ex.qty - sellQty };
      }
    }

    const next = { cash: newCash, positions: newPositions, orders: [newOrder, ...prev.orders].slice(0, 200) };
    setPortfolio(next);
    portfolioRef.current = next;
    return newOrder;
  }

  // ── BOT CYCLE ─────────────────────────────────────────────────────────────

  async function runBotCycle() {
    if (running) return;
    setRunning(true);
    setBotStatus("scanning");

    addLog("──────────────────────────────────");
    addLog("🚀 Starting bot cycle...");

    // Refresh prices first
    await refreshPrices();

    const port = portfolioRef.current;
    const posSnapshot = port.positions;

    const totalPosValue = posSnapshot.reduce((s, p) => s + p.qty * (prices[p.symbol]?.price ?? p.avgEntry), 0);
    const equity        = port.cash + totalPosValue;
    const unrealizedPL  = posSnapshot.reduce((s, p) => {
      const cur = prices[p.symbol]?.price ?? p.avgEntry;
      return s + p.qty * (cur - p.avgEntry);
    }, 0);
    const drawdown = equity > 0 ? unrealizedPL / equity : 0;

    addLog(`💼 Equity: ${fmtUSD(equity)} | Cash: ${fmtUSD(port.cash)} | Unrealized: ${fmtUSD(unrealizedPL)}`);

    if (drawdown < -DAILY_LOSS_LIMIT) {
      addLog(`🚨 Drawdown limit hit (${(drawdown * 100).toFixed(1)}%). Bot halted.`);
      setBotStatus("halted"); setRunning(false); return;
    }

    setBotStatus("analyzing");
    addLog("🔍 Computing consensus scores...");

    const currentSignals = signalsRef.current.length ? signalsRef.current : buildSignals();

    const candidates = currentSignals
      .filter((s) => {
        if (!s.tier || s.action === "HOLD") return false;
        if (s.votes < 2) { addLog(`⭕ ${s.symbol} — only ${s.votes}/3 agree`); return false; }
        if (cooldowns[s.symbol] && Date.now() - cooldowns[s.symbol] < COOLDOWN_MS) {
          addLog(`⭕ ${s.symbol} — in cooldown`); return false;
        }
        if (isCorrelated(s.symbol, posSnapshot)) {
          addLog(`⭕ ${s.symbol} — correlated position open`); return false;
        }
        const tierOpen = posSnapshot.filter((p) => {
          const sig = currentSignals.find((x) => x.symbol === p.symbol);
          return sig?.tier === s.tier;
        }).length;
        if (tierOpen >= RISK_TIERS[s.tier].maxOpen) {
          addLog(`⭕ ${s.symbol} — ${s.tier} tier full`); return false;
        }
        return true;
      })
      .sort((a, b) => b.consensus - a.consensus);

    if (!candidates.length) {
      addLog("⚠️ No qualifying candidates this cycle.");
      setBotStatus("idle"); setRunning(false); return;
    }

    addLog(`🤖 Sending ${candidates.length} candidate(s) to Claude...`);

    let decision;
    try {
      const { parsed, tokenDelta } = await claudePost(anthropicKey, {
        system: `You are an elite low-risk-first trading AI. Pick the single best trade. Return ONLY JSON: {"symbol":"...","action":"buy|sell","tier":"low|medium|high","qty":1,"reasoning":"1 sentence"}. qty must be a positive integer (shares for stocks, fractional ok for crypto). Never exceed $500 per trade.`,
        userContent: `Available cash: ${fmtUSD(port.cash)}\nCandidates:\n${candidates.map((c) =>
          `${c.symbol} | ${c.action} | Consensus:${c.consensus}% | Tier:${c.tier} | Price:$${c.price} | RSI:${c.rsi} | MACD:${c.macd} | Votes:${c.votes}/3`
        ).join("\n")}\n\nPick the best single trade. Keep position size modest (max $500).`,
      });
      decision = parsed;
      setTokenUsed((t) => t + tokenDelta);
    } catch (e) {
      addLog(`⚠️ Claude call failed: ${e.message}`);
      setBotStatus("idle"); setRunning(false); return;
    }

    if (!decision?.symbol) {
      addLog("⚠️ No valid decision returned.");
      setBotStatus("idle"); setRunning(false); return;
    }

    addLog(`✅ AI Decision: ${decision.action?.toUpperCase()} ${decision.symbol} x${decision.qty} (${decision.tier} risk)`);
    addLog(`💬 ${decision.reasoning}`);

    // Kelly position sizing
    const sig     = candidates.find((c) => c.symbol === decision.symbol) || candidates[0];
    const tierCfg = RISK_TIERS[sig?.tier || "medium"];
    const price   = prices[decision.symbol]?.price ?? 100;

    const filledOrd = port.orders.filter((o) => o.status === "filled");
    const winRate   = filledOrd.length > 5 ? 0.55 : 0.5; // conservative until history builds
    const kellyCap  = kellySize(winRate, 0.06, 0.04, equity);
    const maxShares = Math.max(1, Math.floor(Math.min(kellyCap, 500) / price));
    const safeQty   = Math.max(1, Math.min(parseFloat(decision.qty) || 1, maxShares));

    addLog(`📐 Kelly cap: ${fmtUSD(kellyCap)} → qty validated: ${safeQty} @ ${fmtUSD(price)}`);
    addLog(`🎯 SL: -${tierCfg.sl * 100}% | TP: +${tierCfg.tp * 100}%`);

    setBotStatus("executing");
    try {
      const instrType = decision.symbol.includes("/") ? "Cryptocurrency" : "Equity";
      const order     = executeOrder(decision.symbol, safeQty, decision.action, price, instrType);
      addLog(`✈️ Order executed! ID: ${order.id} | ${decision.action.toUpperCase()} ${safeQty} ${decision.symbol} @ ${fmtUSD(price)}`);
      addLog(`💵 Cash remaining: ${fmtUSD(portfolioRef.current.cash)}`);
      setCooldowns((prev) => ({ ...prev, [decision.symbol]: Date.now() }));
    } catch (e) {
      addLog(`❌ Order failed: ${e.message}`);
    }

    setBotStatus("idle");
    setRunning(false);
  }

  // Keep ref current so the auto-run interval always calls the latest closure
  runBotCycleRef.current = runBotCycle;

  // ── CLOSE POSITION ────────────────────────────────────────────────────────

  function handleClose(pos) {
    const price = prices[pos.symbol]?.price ?? pos.avgEntry;
    try {
      executeOrder(pos.symbol, pos.qty, "sell", price, pos.instrumentType);
      const pnl = pos.qty * (price - pos.avgEntry);
      addLog(`✈️ Closed ${pos.symbol}: P&L ${pnl >= 0 ? "+" : ""}${fmtUSD(pnl)}`);
    } catch (e) {
      addLog(`❌ Close failed: ${e.message}`);
    }
  }

  // ── NEWS ANALYSIS (real Yahoo Finance headlines → Claude scoring) ──────────

  async function analyzeNews() {
    addLog("📰 Fetching news headlines from Yahoo Finance...");
    try {
      const allNews = await fetchAllNews(WATCHLIST.map((w) => w.symbol));
      const hasNews = Object.values(allNews).some((h) => h.length > 0);
      if (!hasNews) {
        addLog("⚠️ Yahoo Finance returned no headlines — using mock scores.");
        return;
      }
      addLog("🤖 Scoring sentiment with Claude...");
      const { parsed, tokenDelta } = await claudePost(anthropicKey, {
        system: `Financial sentiment analyst. Score current news sentiment (0-100) for each asset based on the actual headlines. 0=very bearish, 50=neutral, 100=very bullish. Return ONLY a JSON array: [{"symbol":"AAPL","score":72,"headline":"one-line summary"}]. No extra text.`,
        userContent: Object.entries(allNews)
          .map(([sym, items]) => `${sym}: ${items.map((n) => n.title).join(" | ") || "No recent news"}`)
          .join("\n"),
      });
      setTokenUsed((t) => t + tokenDelta);
      const map = {};
      parsed.forEach((p) => {
        map[p.symbol] = p.score;
        setNewsCache((prev) => ({ ...prev, [p.symbol]: p }));
      });
      setNewsScores((prev) => ({ ...prev, ...map }));
      buildSignals(map, prices, technicals);
      addLog(`📰 News sentiment updated for ${Object.keys(map).length} symbols.`);
    } catch (e) {
      addLog(`⚠️ News analysis failed: ${e.message}`);
    }
  }

  // ── RESET PORTFOLIO ───────────────────────────────────────────────────────

  function resetPortfolio() {
    const fresh = { cash: STARTING_BALANCE, positions: [], orders: [] };
    setPortfolio(fresh);
    portfolioRef.current = fresh;
    addLog(`🔄 Portfolio reset to ${fmtUSD(STARTING_BALANCE)}.`);
  }

  // ── DERIVED VALUES ────────────────────────────────────────────────────────

  const positions = portfolio.positions.map((pos) => {
    const cur    = prices[pos.symbol]?.price ?? pos.avgEntry;
    const pnl    = pos.qty * (cur - pos.avgEntry);
    const plpc   = pos.avgEntry > 0 ? pnl / (pos.qty * pos.avgEntry) : 0;
    return { symbol: pos.symbol, instrumentType: pos.instrumentType, side: "long", qty: pos.qty, avgEntry: pos.avgEntry, current_price: cur, unrealized_pl: pnl, unrealized_plpc: plpc };
  });

  const orders = portfolio.orders.slice(0, 20).map((o) => ({
    ...o,
    side:   o.side,
    status: o.status,
  }));

  const totalPosValue  = positions.reduce((s, p) => s + p.qty * p.current_price, 0);
  const totalUnrealized = positions.reduce((s, p) => s + p.unrealized_pl, 0);
  const equity         = portfolio.cash + totalPosValue;
  const buyingPower    = portfolio.cash;
  const dayPnL         = totalUnrealized;
  const dayPnLPct      = equity > 0 ? (dayPnL / equity * 100).toFixed(2) : "0.00";

  const realizedPL = portfolio.orders
    .filter((o) => o.status === "filled" && o.side === "sell")
    .reduce((s, o) => {
      // Simple realized P&L estimation from filled price vs avg entry
      return s + parseFloat(o.qty) * parseFloat(o.filled_avg_price ?? 0);
    }, 0) - portfolio.orders
    .filter((o) => o.status === "filled" && o.side === "sell")
    .reduce((s, o) => {
      const pos = portfolio.positions.find((p) => p.symbol === o.symbol);
      return s + parseFloat(o.qty) * (pos?.avgEntry ?? parseFloat(o.filled_avg_price ?? 0));
    }, 0);

  const orderReturns = portfolio.orders
    .filter((o) => o.status === "filled" && o.side === "sell")
    .map((o) => {
      const buy = portfolio.orders.find((b) => b.symbol === o.symbol && b.side === "buy" && b.created_at < o.created_at);
      if (!buy) return 0;
      return (parseFloat(o.filled_avg_price) - parseFloat(buy.filled_avg_price)) / parseFloat(buy.filled_avg_price);
    })
    .filter(Boolean);
  const sharpe = calcSharpe(orderReturns);

  const filteredSigs   = activeMarket === "All" ? signals : signals.filter((s) => s.market === activeMarket);
  const statusColor    = { idle: "#3d5470", scanning: "#f0c040", analyzing: "#00b8ff", executing: "#00ff9d", halted: "#ff4d6d" };

  const tabs = [
    { id: "signals",   label: "⚡ Signals"   },
    { id: "positions", label: "📊 Positions" },
    { id: "orders",    label: "📋 Orders"    },
    { id: "bot",       label: "🤖 Bot"       },
    { id: "analytics", label: "📈 Analytics" },
  ];

  // ── LOGIN SCREEN ──────────────────────────────────────────────────────────

  if (!connected) {
    return (
      <div style={{ minHeight: "100vh", background: "#080b14", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'IBM Plex Mono',monospace" }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&family=Orbitron:wght@700;900&display=swap');
          @keyframes spin { to { transform: rotate(360deg); } }
          input:focus { border-color: #00ff9d44 !important; outline: none; }
        `}</style>
        <div style={{ width: 440, background: "#0a0e1a", border: "1px solid #1a2535", borderRadius: 12, padding: 36 }}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>⚡</div>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 18, fontWeight: 900, color: "#00ff9d", letterSpacing: 3 }}>NEXUS TRADER</div>
            <div style={{ fontSize: 10, color: "#3d5470", letterSpacing: 2, marginTop: 4 }}>LOCAL SIMULATION · YAHOO FINANCE DATA</div>
          </div>

          <div style={{ background: "#080b14", border: "1px solid #00ff9d22", borderRadius: 6, padding: 12, marginBottom: 20, fontSize: 10, color: "#00ff9d99", lineHeight: 1.8 }}>
            ✓ No broker account needed — trades are simulated locally<br />
            ✓ Live prices + RSI/MACD from Yahoo Finance (no API key)<br />
            ✓ Real news headlines scored by Claude AI<br />
            ✓ Portfolio saved in your browser between sessions
          </div>

          <Input label="ANTHROPIC API KEY" value={anthropicKey} onChange={setAnthropicKey} type="password" placeholder="sk-ant-api03-••••••••••••" />

          {authError && <div style={{ color: "#ff4d6d", fontSize: 11, marginBottom: 14 }}>{authError}</div>}

          <button onClick={connect} disabled={connecting}
            style={{ width: "100%", background: connecting ? "#1a2535" : "#00ff9d", color: connecting ? "#3d5470" : "#000", border: "none", borderRadius: 6, padding: 14, fontSize: 12, fontFamily: "inherit", fontWeight: 700, cursor: connecting ? "not-allowed" : "pointer", letterSpacing: 1 }}>
            {connecting
              ? <><span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid #3d5470", borderTop: "2px solid #00ff9d", borderRadius: "50%", animation: "spin 0.7s linear infinite", verticalAlign: "middle", marginRight: 6 }} />VALIDATING KEY...</>
              : "▶ START TRADING"}
          </button>

          <div style={{ marginTop: 16, fontSize: 9, color: "#1e2d40", textAlign: "center", lineHeight: 1.8 }}>
            Get your free Anthropic key at console.anthropic.com<br />
            Paper trading only — starts with {fmtUSD(STARTING_BALANCE)} virtual balance
          </div>
        </div>
      </div>
    );
  }

  // ── MAIN DASHBOARD ────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", background: "#080b14", color: "#c9d1e0", fontFamily: "'IBM Plex Mono','Fira Code',monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&family=Orbitron:wght@700;900&display=swap');
        @keyframes spin   { to { transform: rotate(360deg); } }
        @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:none} }
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#0d1117} ::-webkit-scrollbar-thumb{background:#1e2d40}
        .hov:hover{background:#0d1420!important} .card:hover{border-color:#00ff9d33!important}
        .btn:hover{filter:brightness(1.15);transform:translateY(-1px)}
        input:focus{border-color:#00ff9d55!important;outline:none}
      `}</style>

      {/* HEADER */}
      <div style={{ background: "#0a0e1a", borderBottom: "1px solid #1a2535", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, background: "linear-gradient(135deg,#00ff9d,#00b8ff)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⚡</div>
          <div>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 13, fontWeight: 900, color: "#00ff9d", letterSpacing: 2 }}>NEXUS TRADER</div>
            <div style={{ fontSize: 8, color: "#3d5470", letterSpacing: 2 }}>PAPER · LOCAL SIM · YAHOO FINANCE</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 24, fontSize: 10 }}>
          {[
            ["EQUITY",    fmtUSD(equity),     "#fff"],
            ["CASH",      fmtUSD(buyingPower), "#c9d1e0"],
            ["P&L",       `${dayPnL >= 0 ? "+" : ""}${fmtUSD(dayPnL)} (${dayPnLPct}%)`, dayPnL >= 0 ? "#00ff9d" : "#ff4d6d"],
            ["BOT",       botStatus.toUpperCase(), statusColor[botStatus]],
          ].map(([label, val, color]) => (
            <div key={label} style={{ textAlign: "right" }}>
              <div style={{ color: "#3d5470", fontSize: 8, letterSpacing: 1 }}>{label}</div>
              <div style={{ color, fontWeight: 700, animation: label === "BOT" && botStatus !== "idle" ? "pulse 1s infinite" : "none" }}>{val}</div>
            </div>
          ))}
          <button onClick={() => { refreshPrices(); refreshTechnicals(); }} disabled={refreshing} className="btn"
            style={{ background: "#0d1117", border: "1px solid #1a2535", borderRadius: 6, color: "#3d5470", fontSize: 10, fontFamily: "inherit", padding: "4px 12px", cursor: "pointer", transition: "all 0.15s" }}>
            {refreshing ? <Spinner size={10} /> : "⟳ REFRESH"}
          </button>
          <button onClick={() => setConnected(false)} className="btn"
            style={{ background: "transparent", border: "1px solid #ff4d6d33", borderRadius: 6, color: "#ff4d6d", fontSize: 10, fontFamily: "inherit", padding: "4px 12px", cursor: "pointer", transition: "all 0.15s" }}>
            DISCONNECT
          </button>
        </div>
      </div>

      {/* MARKET FILTER + LIVE TICKER */}
      <div style={{ background: "#0a0e1a", borderBottom: "1px solid #1a2535", padding: "6px 20px", display: "flex", gap: 4, alignItems: "center" }}>
        {MARKETS.map((m) => (
          <button key={m} onClick={() => setActiveMarket(m)} className="btn"
            style={{ background: activeMarket === m ? "#00ff9d" : "transparent", color: activeMarket === m ? "#000" : "#3d5470", border: "none", borderRadius: 4, padding: "3px 10px", fontSize: 9, fontFamily: "inherit", fontWeight: 700, cursor: "pointer", letterSpacing: 1, transition: "all 0.15s" }}>
            {m}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 16 }}>
          {WATCHLIST.filter((a) => activeMarket === "All" || a.market === activeMarket).map((a) => {
            const q = prices[a.symbol];
            return (
              <span key={a.symbol} style={{ fontSize: 9 }}>
                <span style={{ color: "#3d5470" }}>{a.symbol} </span>
                <span style={{ color: (q?.change ?? 0) >= 0 ? "#00ff9d" : "#ff4d6d", fontWeight: 700 }}>
                  {(q?.change ?? 0) >= 0 ? "+" : ""}{q?.change ?? "–"}%
                </span>
              </span>
            );
          })}
        </div>
      </div>

      {/* TABS */}
      <div style={{ background: "#0a0e1a", borderBottom: "1px solid #1a2535", padding: "0 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex" }}>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} className="btn"
              style={{ background: "transparent", color: activeTab === t.id ? "#00ff9d" : "#3d5470", border: "none", borderBottom: activeTab === t.id ? "2px solid #00ff9d" : "2px solid transparent", padding: "9px 13px", fontSize: 9, fontFamily: "inherit", fontWeight: 700, cursor: "pointer", letterSpacing: 0.5, transition: "all 0.15s" }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 9, color: "#3d5470" }}>
          TOKENS <span style={{ color: tokenUsed > 40000 ? "#ff4d6d" : "#5a7a9a" }}>{tokenUsed.toLocaleString()}</span>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ padding: 20, animation: "fadeIn 0.2s ease" }}>

        {/* ── SIGNALS ── */}
        {activeTab === "signals" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: "#3d5470" }}>CONSENSUS · Technical 50% · News 30% · Social 20% · RSI &amp; MACD from Yahoo Finance</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { refreshPrices(); refreshTechnicals(); }} className="btn"
                  style={{ background: "#0d1117", color: "#00b8ff", border: "1px solid #00b8ff33", borderRadius: 4, padding: "6px 12px", fontSize: 9, fontFamily: "inherit", fontWeight: 700, cursor: "pointer" }}>
                  📊 REFRESH DATA
                </button>
                <button onClick={analyzeNews} className="btn"
                  style={{ background: "#00ff9d", color: "#000", border: "none", borderRadius: 4, padding: "6px 14px", fontSize: 9, fontFamily: "inherit", fontWeight: 700, cursor: "pointer" }}>
                  🤖 REFRESH NEWS AI
                </button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 10 }}>
              {filteredSigs.map((s, i) => {
                const q = quoteData[s.symbol];
                return (
                  <div key={i} className="card"
                    style={{ background: "#0d1117", border: "1px solid #1a2535", borderRadius: 8, padding: 14, opacity: s.tier ? 1 : 0.45, transition: "border-color 0.2s" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                      <div>
                        <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 12, fontWeight: 700, color: "#fff" }}>{s.symbol}</div>
                        <div style={{ fontSize: 8, color: "#3d5470", marginTop: 3 }}>
                          {s.votes}/3 agree · {s.volatility} vol · {s.market}
                          {newsCache[s.symbol] && <span style={{ color: "#5a7a9a" }}> · "{newsCache[s.symbol].headline}"</span>}
                        </div>
                        {/* Yahoo Finance extra data */}
                        {q && (
                          <div style={{ fontSize: 8, color: "#3d5470", marginTop: 3, display: "flex", gap: 8 }}>
                            {q.pe     && <span>P/E {q.pe.toFixed(1)}</span>}
                            {q.high52w && <span>52W H {fmtUSD(q.high52w)}</span>}
                            {q.marketCap && <span>Mkt {fmtNum(q.marketCap)}</span>}
                            {q.analystRating && <span style={{ color: "#5a7a9a" }}>⭐ {q.analystRating}</span>}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                        <ActionBadge action={s.action} />
                        <TierBadge tier={s.tier} />
                      </div>
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 8, color: "#3d5470", marginBottom: 3 }}>CONSENSUS</div>
                      <Bar value={s.consensus} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 8 }}>
                      {[["📊 TECH", s.tech], ["📰 NEWS", s.news], ["💬 SOC", s.social]].map(([label, val]) => (
                        <div key={label}>
                          <div style={{ fontSize: 8, color: "#3d5470" }}>{label}</div>
                          <Bar value={val} height={4} />
                        </div>
                      ))}
                    </div>
                    {s.tier && (
                      <div style={{ fontSize: 9, color: "#5a7a9a", borderTop: "1px solid #1a2535", paddingTop: 8, display: "flex", gap: 10 }}>
                        <span>RSI {s.rsi}</span>
                        <span style={{ color: s.macd === "Bullish" ? "#00ff9d" : s.macd === "Bearish" ? "#ff4d6d" : "#f0c040" }}>MACD {s.macd}</span>
                        <span style={{ color: "#ff4d6d" }}>SL -{RISK_TIERS[s.tier].sl * 100}%</span>
                        <span style={{ color: "#00ff9d" }}>TP +{RISK_TIERS[s.tier].tp * 100}%</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── POSITIONS ── */}
        {activeTab === "positions" && (
          <div>
            <div style={{ fontSize: 9, color: "#3d5470", marginBottom: 14 }}>OPEN POSITIONS — LOCAL SIMULATION</div>
            {positions.length === 0
              ? <div style={{ color: "#1e2d40", fontSize: 12, textAlign: "center", marginTop: 40 }}>No open positions. Run the bot to place trades.</div>
              : (
                <div style={{ background: "#0d1117", border: "1px solid #1a2535", borderRadius: 8, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ fontSize: 9, color: "#3d5470" }}>
                        {["Symbol", "Qty", "Avg Entry", "Current", "Unrealized P&L", "P&L %", "Action"].map((h) => (
                          <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 400 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((p, i) => {
                        const pnlPct = p.unrealized_plpc * 100;
                        return (
                          <tr key={i} className="hov" style={{ borderTop: "1px solid #1a2535", transition: "background 0.15s" }}>
                            <td style={{ padding: "10px 12px", fontFamily: "'Orbitron',monospace", fontSize: 11, color: "#fff" }}>{p.symbol}</td>
                            <td style={{ padding: "10px 12px", fontSize: 11 }}>{p.qty}</td>
                            <td style={{ padding: "10px 12px", fontSize: 11 }}>{fmtUSD(p.avgEntry)}</td>
                            <td style={{ padding: "10px 12px", fontSize: 11 }}>{fmtUSD(p.current_price)}</td>
                            <td style={{ padding: "10px 12px", fontSize: 11, color: p.unrealized_pl >= 0 ? "#00ff9d" : "#ff4d6d" }}>
                              {p.unrealized_pl >= 0 ? "+" : ""}{fmtUSD(p.unrealized_pl)}
                            </td>
                            <td style={{ padding: "10px 12px", fontSize: 11, color: pnlPct >= 0 ? "#00ff9d" : "#ff4d6d" }}>
                              {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <button onClick={() => handleClose(p)} className="btn"
                                style={{ background: "#ff4d6d15", color: "#ff4d6d", border: "1px solid #ff4d6d33", borderRadius: 4, padding: "3px 10px", fontSize: 9, fontFamily: "inherit", cursor: "pointer", transition: "all 0.15s" }}>
                                CLOSE
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        )}

        {/* ── ORDERS ── */}
        {activeTab === "orders" && (
          <div>
            <div style={{ fontSize: 9, color: "#3d5470", marginBottom: 14 }}>TRADE HISTORY — LOCAL SIMULATION (LAST 20)</div>
            {orders.length === 0
              ? <div style={{ color: "#1e2d40", fontSize: 12, textAlign: "center", marginTop: 40 }}>No trades yet.</div>
              : (
                <div style={{ background: "#0d1117", border: "1px solid #1a2535", borderRadius: 8, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ fontSize: 9, color: "#3d5470" }}>
                        {["Symbol", "Side", "Qty", "Price", "Status", "Time"].map((h) => (
                          <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 400 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o, i) => (
                        <tr key={i} className="hov" style={{ borderTop: "1px solid #1a2535", transition: "background 0.15s" }}>
                          <td style={{ padding: "10px 12px", fontFamily: "'Orbitron',monospace", fontSize: 10, color: "#fff" }}>{o.symbol}</td>
                          <td style={{ padding: "10px 12px" }}><ActionBadge action={o.side.toUpperCase()} /></td>
                          <td style={{ padding: "10px 12px", fontSize: 10 }}>{o.qty}</td>
                          <td style={{ padding: "10px 12px", fontSize: 10 }}>{o.filled_avg_price ? fmtUSD(o.filled_avg_price) : "–"}</td>
                          <td style={{ padding: "10px 12px", fontSize: 10, color: "#00ff9d" }}>{o.status.toUpperCase()}</td>
                          <td style={{ padding: "10px 12px", fontSize: 10, color: "#3d5470" }}>{new Date(o.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        )}

        {/* ── BOT ── */}
        {activeTab === "bot" && (() => {
          const mkt = marketStatusText();
          return (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Market status + auto-run bar */}
            <div style={{ background: "#0d1117", border: `1px solid ${mkt.open ? "#00ff9d33" : "#1a2535"}`, borderRadius: 8, padding: "12px 16px", display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: mkt.open ? "#00ff9d" : "#3d5470", display: "inline-block", animation: mkt.open ? "pulse 1.5s infinite" : "none" }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: mkt.open ? "#00ff9d" : "#3d5470", letterSpacing: 1 }}>{mkt.label}</span>
                <span style={{ fontSize: 9, color: "#3d5470" }}>{mkt.sub}</span>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 9, color: "#3d5470" }}>AUTO-RUN EVERY</span>
                <select value={cycleInterval} onChange={(e) => setCycleInterval(Number(e.target.value))}
                  style={{ background: "#080b14", border: "1px solid #1a2535", borderRadius: 4, color: "#c9d1e0", fontFamily: "inherit", fontSize: 9, padding: "3px 6px", cursor: "pointer" }}>
                  {[15, 30, 60].map((m) => <option key={m} value={m}>{m}m</option>)}
                </select>
                <button
                  onClick={() => setAutoMode((v) => !v)}
                  className="btn"
                  style={{ background: autoMode ? "#00ff9d" : "#1a2535", color: autoMode ? "#000" : "#3d5470", border: `1px solid ${autoMode ? "#00ff9d" : "#1a2535"}`, borderRadius: 6, padding: "5px 14px", fontSize: 10, fontFamily: "inherit", fontWeight: 700, cursor: "pointer", transition: "all 0.2s", letterSpacing: 1 }}>
                  {autoMode ? "⏹ STOP AUTO" : "▶ START AUTO"}
                </button>
                {autoMode && countdown && (
                  <span style={{ fontSize: 9, color: "#5a7a9a" }}>next in <span style={{ color: "#00b8ff", fontWeight: 700 }}>{countdown}</span></span>
                )}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div style={{ background: "#0d1117", border: "1px solid #1a2535", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 9, color: "#3d5470", marginBottom: 12, letterSpacing: 1 }}>CONFIGURATION</div>
                {[
                  ["Mode",             "Local paper simulation"],
                  ["Price Data",       "Yahoo Finance (live)"],
                  ["Technicals",       "RSI + MACD (Yahoo OHLCV)"],
                  ["News Sentiment",   "Claude AI via Yahoo headlines"],
                  ["Capital Tiers",    "Low 60% · Med 30% · High 10%"],
                  ["Position Sizing",  "Kelly Criterion (half-Kelly)"],
                  ["Min Source Votes", "2 of 3 must agree"],
                  ["Cooldown/Asset",   "15 minutes"],
                  ["Daily Loss Limit", `${DAILY_LOSS_LIMIT * 100}% of equity`],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 10 }}>
                    <span style={{ color: "#3d5470" }}>{k}</span>
                    <span style={{ color: "#c9d1e0" }}>{v}</span>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button onClick={runBotCycle} disabled={running || botStatus === "halted"} className="btn"
                  style={{ background: running ? "#1a2535" : botStatus === "halted" ? "#ff4d6d22" : "#00ff9d", color: running ? "#3d5470" : botStatus === "halted" ? "#ff4d6d" : "#000", border: "none", borderRadius: 6, padding: 16, fontSize: 12, fontFamily: "inherit", fontWeight: 700, cursor: running || botStatus === "halted" ? "not-allowed" : "pointer", letterSpacing: 1, transition: "all 0.2s" }}>
                  {running ? <><Spinner />RUNNING...</> : botStatus === "halted" ? "🚨 HALTED" : "▶ RUN BOT CYCLE"}
                </button>

                {Object.entries(RISK_TIERS).map(([tier, cfg]) => {
                  const openInTier = positions.filter((p) => {
                    const sig = signals.find((s) => s.symbol === p.symbol);
                    return sig?.tier === tier;
                  }).length;
                  return (
                    <div key={tier} style={{ background: "#0d1117", border: "1px solid #1a2535", borderRadius: 6, padding: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                        <TierBadge tier={tier} />
                        <span style={{ fontSize: 9, color: "#3d5470" }}>{openInTier}/{cfg.maxOpen} open · SL-{cfg.sl * 100}% TP+{cfg.tp * 100}%</span>
                      </div>
                      <Bar value={cfg.allocation * 100} color={cfg.color} height={4} />
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ background: "#060910", border: "1px solid #1a2535", borderRadius: 6, padding: 12 }}>
              <div style={{ fontSize: 9, color: "#3d5470", marginBottom: 6, letterSpacing: 1 }}>EXECUTION LOG</div>
              <div ref={logRef} style={{ height: 200, overflowY: "auto", fontSize: 10, lineHeight: 1.9 }}>
                {log.length === 0
                  ? <span style={{ color: "#1e2d40" }}>Press RUN BOT CYCLE or enable AUTO to begin...</span>
                  : log.map((l, i) => (
                    <div key={i} style={{ animation: "fadeIn 0.25s ease" }}>
                      <span style={{ color: "#1a3040" }}>[{l.time}]</span>{" "}
                      <span style={{ color: "#c9d1e0" }}>{l.msg}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
          );
        })()}

        {/* ── ANALYTICS ── */}
        {activeTab === "analytics" && (
          <div>
            <div style={{ fontSize: 9, color: "#3d5470", marginBottom: 14 }}>PERFORMANCE ANALYTICS</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
              <StatCard label="EQUITY"     value={fmtUSD(equity)}    color="#fff"  sub={`Started at ${fmtUSD(STARTING_BALANCE)}`} />
              <StatCard label="CASH"       value={fmtUSD(buyingPower)} sub="Available to deploy" />
              <StatCard label="P&L"        value={`${dayPnL >= 0 ? "+" : ""}${fmtUSD(dayPnL)}`} color={dayPnL >= 0 ? "#00ff9d" : "#ff4d6d"} sub={`${dayPnLPct}% open positions`} />
              <StatCard label="TOTAL GAIN" value={fmtUSD(equity - STARTING_BALANCE)} color={equity >= STARTING_BALANCE ? "#00ff9d" : "#ff4d6d"} sub="vs starting balance" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
              <StatCard label="OPEN POSITIONS" value={positions.length} sub={`of ${Object.values(RISK_TIERS).reduce((s, t) => s + t.maxOpen, 0)} max`} />
              <StatCard label="TOTAL TRADES"   value={portfolio.orders.length} sub="All time" />
              <StatCard label="COOLDOWNS"      value={Object.keys(cooldowns).length} sub="Assets locked" />
              <StatCard label="TOKENS USED"    value={tokenUsed.toLocaleString()} color={tokenUsed > 40000 ? "#ff4d6d" : "#c9d1e0"} sub="Claude API" />
            </div>

            {/* Yahoo Finance data source status */}
            <div style={{ background: "#0d1117", border: "1px solid #1a2535", borderRadius: 8, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: "#3d5470", marginBottom: 12 }}>LIVE DATA SOURCES</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                {WATCHLIST.map((a) => {
                  const q    = quoteData[a.symbol];
                  const tech = technicals[a.symbol];
                  const isLive = !!q;
                  return (
                    <div key={a.symbol} style={{ display: "flex", justifyContent: "space-between", fontSize: 10, padding: "8px 0", borderBottom: "1px solid #1a2535" }}>
                      <span style={{ fontFamily: "'Orbitron',monospace", color: "#fff", fontSize: 9 }}>{a.symbol}</span>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <span style={{ color: isLive ? "#00ff9d" : "#3d5470", fontSize: 8 }}>{isLive ? "● LIVE" : "○ MOCK"}</span>
                        {tech && <span style={{ color: "#5a7a9a", fontSize: 8 }}>RSI {tech.rsi}</span>}
                        {q?.pe && <span style={{ color: "#5a7a9a", fontSize: 8 }}>P/E {q.pe.toFixed(0)}</span>}
                        {q && <span style={{ color: q.change >= 0 ? "#00ff9d" : "#ff4d6d", fontSize: 8, fontWeight: 700 }}>{q.change >= 0 ? "+" : ""}{q.change}%</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={resetPortfolio} className="btn"
                style={{ background: "#ff4d6d15", color: "#ff4d6d", border: "1px solid #ff4d6d33", borderRadius: 6, padding: "8px 20px", fontSize: 10, fontFamily: "inherit", fontWeight: 700, cursor: "pointer", transition: "all 0.15s" }}>
                🔄 RESET PORTFOLIO TO {fmtUSD(STARTING_BALANCE)}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
