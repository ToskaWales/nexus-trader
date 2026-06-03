import { useState, useEffect, useRef } from "react";
import {
  MARKETS, WATCHLIST, SOURCE_WEIGHTS, RISK_TIERS,
  MOCK_PRICES, MOCK_TECH, MOCK_NEWS_SCORES, MOCK_SOCIAL, STARTING_BALANCE,
} from "./constants.js";
import { fetchQuotes, fetchAllTechnicals } from "./api/yahoo.js";

// Portfolio lives in the repo — bot writes it, dashboard reads it.
const PORTFOLIO_URL =
  "https://api.github.com/repos/ToskaWales/nexus-trader/contents/portfolio.json";

async function fetchPortfolio() {
  const res = await fetch(PORTFOLIO_URL, {
    headers: { Accept: "application/vnd.github.raw+json" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return res.json();
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function calcConsensus(t, n, s) {
  return Math.round(t * SOURCE_WEIGHTS.technical + n * SOURCE_WEIGHTS.news + s * SOURCE_WEIGHTS.social);
}

function assignTier(consensus, volatility) {
  if (consensus >= 75 && volatility !== "High") return "low";
  if (consensus >= 75)  return "medium";
  if (consensus >= 60)  return "medium";
  if (consensus >= 45)  return "high";
  return null;
}

function marketStatusText() {
  const et   = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day  = et.getDay();
  const mins = et.getHours() * 60 + et.getMinutes();
  const isWeekend = day === 0 || day === 6;
  if (isWeekend) return { open: false, label: "WEEKEND",    sub: "Crypto still active" };
  if (mins < 570) return { open: false, label: "PRE-MARKET", sub: `Opens in ${Math.floor((570-mins)/60)}h ${(570-mins)%60}m` };
  if (mins < 960) return { open: true,  label: "OPEN",       sub: `Closes in ${Math.floor((960-mins)/60)}h ${(960-mins)%60}m` };
  return { open: false, label: "AFTER-HOURS", sub: "Opens tomorrow 9:30 ET" };
}

const fmtUSD = (n) =>
  `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtNum = (n) =>
  n >= 1e12 ? `${(n/1e12).toFixed(1)}T` : n >= 1e9 ? `${(n/1e9).toFixed(1)}B` : n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : String(n);

// ── UI ────────────────────────────────────────────────────────────────────────

function Spinner({ size = 13 }) {
  return <span style={{ display:"inline-block", width:size, height:size, border:"2px solid #00ff9d22", borderTop:"2px solid #00ff9d", borderRadius:"50%", animation:"spin 0.7s linear infinite", verticalAlign:"middle", marginRight:6 }} />;
}

function TierBadge({ tier }) {
  if (!tier) return <span style={{ fontSize:9, color:"#3d5470", border:"1px solid #1a2535", borderRadius:3, padding:"1px 6px" }}>SKIP</span>;
  const t = RISK_TIERS[tier];
  return <span style={{ background:t.bg, color:t.color, border:`1px solid ${t.color}44`, borderRadius:4, padding:"2px 8px", fontSize:9, fontWeight:800, letterSpacing:1 }}>{t.label} RISK</span>;
}

function SideBadge({ side }) {
  const cfg = { buy:"#00ff9d", sell:"#ff4d6d", long:"#00ff9d", short:"#ff4d6d" };
  const color = cfg[side?.toLowerCase()] ?? "#f0c040";
  return <span style={{ background:`${color}15`, color, border:`1px solid ${color}44`, borderRadius:4, padding:"2px 9px", fontWeight:800, fontSize:10, letterSpacing:1 }}>{side?.toUpperCase()}</span>;
}

function Bar({ value, color, height = 5 }) {
  const c = color || (value >= 70 ? "#00ff9d" : value >= 50 ? "#f0c040" : "#ff4d6d");
  return (
    <div style={{ display:"flex", alignItems:"center", gap:7 }}>
      <div style={{ flex:1, height, background:"#1a1f2e", borderRadius:3, overflow:"hidden" }}>
        <div style={{ width:`${Math.min(100, Math.max(0, value))}%`, height:"100%", background:c, borderRadius:3, transition:"width 0.8s" }} />
      </div>
      <span style={{ color:c, fontSize:10, fontWeight:700, minWidth:28 }}>{Math.round(value)}%</span>
    </div>
  );
}

function StatCard({ label, value, color = "#fff", sub }) {
  return (
    <div style={{ background:"#0d1117", border:"1px solid #1a2535", borderRadius:8, padding:"14px 16px" }}>
      <div style={{ fontSize:9, color:"#3d5470", letterSpacing:1, marginBottom:5 }}>{label}</div>
      <div style={{ fontFamily:"'Orbitron',monospace", fontSize:17, fontWeight:700, color }}>{value}</div>
      {sub && <div style={{ fontSize:9, color:"#3d5470", marginTop:3 }}>{sub}</div>}
    </div>
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [portfolio,   setPortfolio]   = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [loadError,   setLoadError]   = useState("");
  const [prices,      setPrices]      = useState(MOCK_PRICES);
  const [quoteData,   setQuoteData]   = useState({});
  const [technicals,  setTechnicals]  = useState(MOCK_TECH);
  const [signals,     setSignals]     = useState([]);
  const [activeMarket,setActiveMarket]= useState("All");
  const [activeTab,   setActiveTab]   = useState("signals");
  const [refreshing,  setRefreshing]  = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [newsCache,   setNewsCache]   = useState({});
  const [countdown,   setCountdown]   = useState("");

  // ── LOAD PORTFOLIO ─────────────────────────────────────────────────────────

  async function loadPortfolio() {
    setRefreshing(true);
    try {
      const p = await fetchPortfolio();
      setPortfolio(p);
      setLoadError("");
    } catch (e) {
      setLoadError(`Could not load portfolio: ${e.message}`);
    }
    setLastRefresh(new Date());
    setRefreshing(false);
    setLoading(false);
  }

  // ── MARKET DATA ────────────────────────────────────────────────────────────

  async function refreshMarketData() {
    const [live, techs] = await Promise.all([
      fetchQuotes(WATCHLIST.map(w => w.symbol)).catch(() => ({})),
      fetchAllTechnicals(WATCHLIST.map(w => w.symbol)).catch(() => ({})),
    ]);
    if (Object.keys(live).length)  { setPrices(p => ({ ...p, ...live })); setQuoteData(live); }
    if (Object.keys(techs).length)   setTechnicals(p => ({ ...p, ...techs }));
  }

  // ── SIGNALS ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const built = WATCHLIST.map(asset => {
      const tech  = technicals[asset.symbol]?.score ?? MOCK_TECH[asset.symbol]?.score ?? 50;
      const news  = MOCK_NEWS_SCORES[asset.symbol] ?? 50;
      const soc   = MOCK_SOCIAL[asset.symbol]      ?? 50;
      const cons  = calcConsensus(tech, news, soc);
      const tier  = assignTier(cons, asset.volatility);
      const action = cons >= 62 ? "BUY" : cons <= 42 ? "SELL" : "HOLD";
      const votes  = [tech >= 62, news >= 62, soc >= 62].filter(Boolean).length;
      const q = prices[asset.symbol];
      return { ...asset, tech, news, social: soc, consensus: cons, tier, action, votes,
               rsi: technicals[asset.symbol]?.rsi ?? MOCK_TECH[asset.symbol]?.rsi,
               macd: technicals[asset.symbol]?.macd ?? MOCK_TECH[asset.symbol]?.macd,
               price: q?.price, change: q?.change };
    });
    setSignals(built);
  }, [prices, technicals]);

  // ── INIT + AUTO-REFRESH ────────────────────────────────────────────────────

  useEffect(() => {
    loadPortfolio();
    refreshMarketData();

    // Refresh portfolio every 5 minutes
    const portfolioTimer = setInterval(loadPortfolio, 5 * 60 * 1000);
    // Refresh market data every 2 minutes
    const marketTimer    = setInterval(refreshMarketData, 2 * 60 * 1000);
    return () => { clearInterval(portfolioTimer); clearInterval(marketTimer); };
  }, []); // eslint-disable-line

  // Countdown to next portfolio refresh
  useEffect(() => {
    if (!lastRefresh) return;
    const id = setInterval(() => {
      const nextAt = lastRefresh.getTime() + 5 * 60 * 1000;
      const diff   = Math.max(0, nextAt - Date.now());
      const m = Math.floor(diff / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setCountdown(`${m}:${String(s).padStart(2, "0")}`);
    }, 1_000);
    return () => clearInterval(id);
  }, [lastRefresh]);

  // ── DERIVED ────────────────────────────────────────────────────────────────

  const positions = (portfolio?.positions ?? []).map(pos => {
    const cur  = prices[pos.symbol]?.price ?? pos.avgEntry;
    const pnl  = pos.qty * (cur - pos.avgEntry);
    const plpc = pos.avgEntry > 0 ? pnl / (pos.qty * pos.avgEntry) : 0;
    return { ...pos, current_price: cur, unrealized_pl: pnl, unrealized_plpc: plpc };
  });

  const orders = (portfolio?.orders ?? []).slice(0, 20);

  const totalPosValue  = positions.reduce((s, p) => s + p.qty * p.current_price, 0);
  const totalUnrealized = positions.reduce((s, p) => s + p.unrealized_pl, 0);
  const equity         = (portfolio?.cash ?? 0) + totalPosValue;
  const cash           = portfolio?.cash ?? 0;
  const totalGain      = equity - STARTING_BALANCE;
  const dayPnLPct      = equity > 0 ? (totalUnrealized / equity * 100).toFixed(2) : "0.00";

  const filteredSigs = activeMarket === "All" ? signals : signals.filter(s => s.market === activeMarket);
  const mkt = marketStatusText();

  const tabs = [
    { id: "signals",   label: "⚡ Signals"   },
    { id: "positions", label: "📊 Positions" },
    { id: "orders",    label: "📋 Orders"    },
    { id: "bot",       label: "🤖 Bot Status" },
    { id: "analytics", label: "📈 Analytics" },
  ];

  // ── LOADING SCREEN ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ minHeight:"100vh", background:"#080b14", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'IBM Plex Mono',monospace" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&family=Orbitron:wght@700;900&display=swap'); @keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontFamily:"'Orbitron',monospace", fontSize:18, fontWeight:900, color:"#00ff9d", letterSpacing:3, marginBottom:20 }}>NEXUS TRADER</div>
          <Spinner size={20} />
          <div style={{ fontSize:10, color:"#3d5470", marginTop:16 }}>Loading portfolio from GitHub...</div>
          {loadError && <div style={{ color:"#ff4d6d", fontSize:11, marginTop:12 }}>{loadError}</div>}
        </div>
      </div>
    );
  }

  // ── DASHBOARD ──────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight:"100vh", background:"#080b14", color:"#c9d1e0", fontFamily:"'IBM Plex Mono','Fira Code',monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&family=Orbitron:wght@700;900&display=swap');
        @keyframes spin   { to { transform: rotate(360deg); } }
        @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:none} }
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#0d1117} ::-webkit-scrollbar-thumb{background:#1e2d40}
        .hov:hover{background:#0d1420!important} .card:hover{border-color:#00ff9d33!important}
        .btn:hover{filter:brightness(1.15);transform:translateY(-1px)}
      `}</style>

      {/* HEADER */}
      <div style={{ background:"#0a0e1a", borderBottom:"1px solid #1a2535", padding:"12px 20px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:34, height:34, background:"linear-gradient(135deg,#00ff9d,#00b8ff)", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>⚡</div>
          <div>
            <div style={{ fontFamily:"'Orbitron',monospace", fontSize:13, fontWeight:900, color:"#00ff9d", letterSpacing:2 }}>NEXUS TRADER</div>
            <div style={{ fontSize:8, color:"#3d5470", letterSpacing:2 }}>AUTONOMOUS · GITHUB ACTIONS BOT</div>
          </div>
        </div>

        <div style={{ display:"flex", gap:24, fontSize:10 }}>
          {[
            ["EQUITY",    fmtUSD(equity),                    "#fff"                              ],
            ["CASH",      fmtUSD(cash),                      "#c9d1e0"                           ],
            ["P&L",       `${totalUnrealized >= 0?"+":""}${fmtUSD(totalUnrealized)}`, totalUnrealized >= 0 ? "#00ff9d" : "#ff4d6d"],
            ["TOTAL",     `${totalGain >= 0?"+":""}${fmtUSD(totalGain)}`, totalGain >= 0 ? "#00ff9d" : "#ff4d6d"],
          ].map(([label, val, color]) => (
            <div key={label} style={{ textAlign:"right" }}>
              <div style={{ color:"#3d5470", fontSize:8, letterSpacing:1 }}>{label}</div>
              <div style={{ color, fontWeight:700 }}>{val}</div>
            </div>
          ))}
          <button onClick={() => { loadPortfolio(); refreshMarketData(); }} disabled={refreshing} className="btn"
            style={{ background:"#0d1117", border:"1px solid #1a2535", borderRadius:6, color:"#3d5470", fontSize:10, fontFamily:"inherit", padding:"4px 12px", cursor:"pointer", transition:"all 0.15s" }}>
            {refreshing ? <Spinner size={10} /> : "⟳ REFRESH"}
          </button>
        </div>
      </div>

      {/* TICKER */}
      <div style={{ background:"#0a0e1a", borderBottom:"1px solid #1a2535", padding:"6px 20px", display:"flex", gap:4, alignItems:"center" }}>
        {MARKETS.map(m => (
          <button key={m} onClick={() => setActiveMarket(m)} className="btn"
            style={{ background:activeMarket===m?"#00ff9d":"transparent", color:activeMarket===m?"#000":"#3d5470", border:"none", borderRadius:4, padding:"3px 10px", fontSize:9, fontFamily:"inherit", fontWeight:700, cursor:"pointer", letterSpacing:1, transition:"all 0.15s" }}>
            {m}
          </button>
        ))}
        <div style={{ marginLeft:"auto", display:"flex", gap:16 }}>
          {WATCHLIST.filter(a => activeMarket==="All" || a.market===activeMarket).map(a => {
            const q = prices[a.symbol];
            return (
              <span key={a.symbol} style={{ fontSize:9 }}>
                <span style={{ color:"#3d5470" }}>{a.symbol} </span>
                <span style={{ color:(q?.change??0)>=0?"#00ff9d":"#ff4d6d", fontWeight:700 }}>
                  {(q?.change??0)>=0?"+":""}{q?.change??"–"}%
                </span>
              </span>
            );
          })}
        </div>
        <div style={{ marginLeft:16, fontSize:9, color:"#3d5470" }}>
          next refresh <span style={{ color:"#00b8ff" }}>{countdown}</span>
        </div>
      </div>

      {/* TABS */}
      <div style={{ background:"#0a0e1a", borderBottom:"1px solid #1a2535", padding:"0 20px", display:"flex" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} className="btn"
            style={{ background:"transparent", color:activeTab===t.id?"#00ff9d":"#3d5470", border:"none", borderBottom:activeTab===t.id?"2px solid #00ff9d":"2px solid transparent", padding:"9px 13px", fontSize:9, fontFamily:"inherit", fontWeight:700, cursor:"pointer", letterSpacing:0.5, transition:"all 0.15s" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* CONTENT */}
      <div style={{ padding:20, animation:"fadeIn 0.2s ease" }}>

        {/* ── SIGNALS ── */}
        {activeTab === "signals" && (
          <div>
            <div style={{ fontSize:9, color:"#3d5470", marginBottom:14 }}>
              LIVE SIGNALS · Technical 50% · News 30% · Social 20% · RSI & MACD from Yahoo Finance
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:10 }}>
              {filteredSigs.map((s, i) => {
                const q = quoteData[s.symbol];
                return (
                  <div key={i} className="card" style={{ background:"#0d1117", border:"1px solid #1a2535", borderRadius:8, padding:14, opacity:s.tier?1:0.45, transition:"border-color 0.2s" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                      <div>
                        <div style={{ fontFamily:"'Orbitron',monospace", fontSize:12, fontWeight:700, color:"#fff" }}>{s.symbol}</div>
                        <div style={{ fontSize:8, color:"#3d5470", marginTop:3 }}>{s.votes}/3 agree · {s.volatility} vol · {s.market}</div>
                        {q && (
                          <div style={{ fontSize:8, color:"#3d5470", marginTop:2, display:"flex", gap:8 }}>
                            {q.pe       && <span>P/E {q.pe.toFixed(1)}</span>}
                            {q.marketCap && <span>Mkt {fmtNum(q.marketCap)}</span>}
                            {q.analystRating && <span style={{ color:"#5a7a9a" }}>⭐ {q.analystRating}</span>}
                          </div>
                        )}
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"flex-end" }}>
                        <span style={{ background:s.action==="BUY"?"#00ff9d15":s.action==="SELL"?"#ff4d6d15":"#f0c04015", color:s.action==="BUY"?"#00ff9d":s.action==="SELL"?"#ff4d6d":"#f0c040", border:`1px solid ${s.action==="BUY"?"#00ff9d":s.action==="SELL"?"#ff4d6d":"#f0c040"}44`, borderRadius:4, padding:"2px 9px", fontWeight:800, fontSize:10, letterSpacing:1 }}>{s.action}</span>
                        <TierBadge tier={s.tier} />
                      </div>
                    </div>
                    <div style={{ marginBottom:8 }}>
                      <div style={{ fontSize:8, color:"#3d5470", marginBottom:3 }}>CONSENSUS</div>
                      <Bar value={s.consensus} />
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginBottom:8 }}>
                      {[["📊 TECH", s.tech], ["📰 NEWS", s.news], ["💬 SOC", s.social]].map(([label, val]) => (
                        <div key={label}>
                          <div style={{ fontSize:8, color:"#3d5470" }}>{label}</div>
                          <Bar value={val} height={4} />
                        </div>
                      ))}
                    </div>
                    {s.tier && (
                      <div style={{ fontSize:9, color:"#5a7a9a", borderTop:"1px solid #1a2535", paddingTop:8, display:"flex", gap:10 }}>
                        <span>RSI {s.rsi}</span>
                        <span style={{ color:s.macd==="Bullish"?"#00ff9d":s.macd==="Bearish"?"#ff4d6d":"#f0c040" }}>MACD {s.macd}</span>
                        <span style={{ color:"#ff4d6d" }}>SL -{RISK_TIERS[s.tier].sl*100}%</span>
                        <span style={{ color:"#00ff9d" }}>TP +{RISK_TIERS[s.tier].tp*100}%</span>
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
            <div style={{ fontSize:9, color:"#3d5470", marginBottom:14 }}>OPEN POSITIONS — MANAGED BY BOT</div>
            {positions.length === 0
              ? <div style={{ color:"#1e2d40", fontSize:12, textAlign:"center", marginTop:40 }}>No open positions yet — bot will enter when signals qualify.</div>
              : (
                <div style={{ background:"#0d1117", border:"1px solid #1a2535", borderRadius:8, overflow:"hidden" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse" }}>
                    <thead>
                      <tr style={{ fontSize:9, color:"#3d5470" }}>
                        {["Symbol","Tier","Qty","Avg Entry","Current","P&L","P&L %","SL Target","TP Target"].map(h => (
                          <th key={h} style={{ padding:"8px 12px", textAlign:"left", fontWeight:400 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((p, i) => {
                        const pnlPct  = p.unrealized_plpc * 100;
                        const tierCfg = RISK_TIERS[p.tier ?? "medium"];
                        return (
                          <tr key={i} className="hov" style={{ borderTop:"1px solid #1a2535", transition:"background 0.15s" }}>
                            <td style={{ padding:"10px 12px", fontFamily:"'Orbitron',monospace", fontSize:11, color:"#fff" }}>{p.symbol}</td>
                            <td style={{ padding:"10px 12px" }}><TierBadge tier={p.tier} /></td>
                            <td style={{ padding:"10px 12px", fontSize:11 }}>{p.qty}</td>
                            <td style={{ padding:"10px 12px", fontSize:11 }}>{fmtUSD(p.avgEntry)}</td>
                            <td style={{ padding:"10px 12px", fontSize:11 }}>{fmtUSD(p.current_price)}</td>
                            <td style={{ padding:"10px 12px", fontSize:11, color:p.unrealized_pl>=0?"#00ff9d":"#ff4d6d" }}>
                              {p.unrealized_pl>=0?"+":""}{fmtUSD(p.unrealized_pl)}
                            </td>
                            <td style={{ padding:"10px 12px", fontSize:11, color:pnlPct>=0?"#00ff9d":"#ff4d6d" }}>
                              {pnlPct>=0?"+":""}{pnlPct.toFixed(2)}%
                            </td>
                            <td style={{ padding:"10px 12px", fontSize:10, color:"#ff4d6d" }}>
                              {fmtUSD(p.avgEntry * (1 - (tierCfg?.sl ?? 0.04)))}
                            </td>
                            <td style={{ padding:"10px 12px", fontSize:10, color:"#00ff9d" }}>
                              {fmtUSD(p.avgEntry * (1 + (tierCfg?.tp ?? 0.12)))}
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
            <div style={{ fontSize:9, color:"#3d5470", marginBottom:14 }}>TRADE HISTORY — EXECUTED BY BOT (LAST 20)</div>
            {orders.length === 0
              ? <div style={{ color:"#1e2d40", fontSize:12, textAlign:"center", marginTop:40 }}>No trades yet.</div>
              : (
                <div style={{ background:"#0d1117", border:"1px solid #1a2535", borderRadius:8, overflow:"hidden" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse" }}>
                    <thead>
                      <tr style={{ fontSize:9, color:"#3d5470" }}>
                        {["Symbol","Side","Qty","Price","Reason","P&L","Time"].map(h => (
                          <th key={h} style={{ padding:"8px 12px", textAlign:"left", fontWeight:400 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o, i) => (
                        <tr key={i} className="hov" style={{ borderTop:"1px solid #1a2535", transition:"background 0.15s" }}>
                          <td style={{ padding:"10px 12px", fontFamily:"'Orbitron',monospace", fontSize:10, color:"#fff" }}>{o.symbol}</td>
                          <td style={{ padding:"10px 12px" }}><SideBadge side={o.side} /></td>
                          <td style={{ padding:"10px 12px", fontSize:10 }}>{o.qty}</td>
                          <td style={{ padding:"10px 12px", fontSize:10 }}>{o.filled_avg_price ? fmtUSD(o.filled_avg_price) : "–"}</td>
                          <td style={{ padding:"10px 12px", fontSize:9, color:"#5a7a9a" }}>
                            {o.reason === "stop_loss" ? "🛑 stop loss" : o.reason === "take_profit" ? "🎯 take profit" : o.reasoning ? `"${o.reasoning}"` : "–"}
                          </td>
                          <td style={{ padding:"10px 12px", fontSize:10, color:parseFloat(o.pnl??0)>=0?"#00ff9d":"#ff4d6d" }}>
                            {o.pnl ? `${parseFloat(o.pnl)>=0?"+":""}${fmtUSD(o.pnl)}` : "–"}
                          </td>
                          <td style={{ padding:"10px 12px", fontSize:9, color:"#3d5470" }}>
                            {new Date(o.created_at).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        )}

        {/* ── BOT STATUS ── */}
        {activeTab === "bot" && (
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

            {/* Market + bot status */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
              <div style={{ background:"#0d1117", border:`1px solid ${mkt.open?"#00ff9d33":"#1a2535"}`, borderRadius:8, padding:16 }}>
                <div style={{ fontSize:9, color:"#3d5470", marginBottom:12, letterSpacing:1 }}>MARKET STATUS</div>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                  <span style={{ width:10, height:10, borderRadius:"50%", background:mkt.open?"#00ff9d":"#3d5470", display:"inline-block", animation:mkt.open?"pulse 1.5s infinite":"none" }} />
                  <span style={{ fontFamily:"'Orbitron',monospace", fontSize:14, fontWeight:700, color:mkt.open?"#00ff9d":"#3d5470" }}>{mkt.label}</span>
                </div>
                <div style={{ fontSize:10, color:"#5a7a9a" }}>{mkt.sub}</div>
                <div style={{ marginTop:8, fontSize:9, color:"#3d5470" }}>Crypto trades 24/7 regardless</div>
              </div>

              <div style={{ background:"#0d1117", border:"1px solid #1a2535", borderRadius:8, padding:16 }}>
                <div style={{ fontSize:9, color:"#3d5470", marginBottom:12, letterSpacing:1 }}>BOT STATUS</div>
                {portfolio?.haltReason ? (
                  <div style={{ color:"#ff4d6d", fontWeight:700, fontSize:12 }}>🚨 HALTED — {portfolio.haltReason}</div>
                ) : (
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                    <span style={{ width:10, height:10, borderRadius:"50%", background:"#00ff9d", display:"inline-block", animation:"pulse 1.5s infinite" }} />
                    <span style={{ fontFamily:"'Orbitron',monospace", fontSize:14, fontWeight:700, color:"#00ff9d" }}>RUNNING</span>
                  </div>
                )}
                <div style={{ fontSize:10, color:"#5a7a9a", marginTop:4 }}>
                  Last run: {portfolio?.lastRun ? new Date(portfolio.lastRun).toLocaleString() : "Never"}
                </div>
                <div style={{ fontSize:9, color:"#3d5470", marginTop:4 }}>Runs every 30 min via GitHub Actions</div>
              </div>
            </div>

            {/* Configuration */}
            <div style={{ background:"#0d1117", border:"1px solid #1a2535", borderRadius:8, padding:16 }}>
              <div style={{ fontSize:9, color:"#3d5470", marginBottom:12, letterSpacing:1 }}>CONFIGURATION</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                {[
                  ["Schedule",         "Every 30 min · GitHub Actions"],
                  ["Price Data",       "Yahoo Finance (live)"],
                  ["Technical",        "RSI + MACD from 90-day OHLCV"],
                  ["Trade Decision",   "Claude claude-sonnet-4-6"],
                  ["Position Sizing",  "Kelly Criterion (half-Kelly, max $500)"],
                  ["Stop Loss",        "Low 2% · Med 4% · High 7%"],
                  ["Take Profit",      "Low 5% · Med 12% · High 25%"],
                  ["Daily Loss Limit", "5% of equity — bot halts if hit"],
                  ["Cooldown",         "15 min per symbol after trade"],
                  ["Correlation",      "Won't hold both BTC & ETH, etc."],
                ].map(([k, v]) => (
                  <div key={k} style={{ display:"flex", justifyContent:"space-between", fontSize:10, padding:"4px 0", borderBottom:"1px solid #1a2535" }}>
                    <span style={{ color:"#3d5470" }}>{k}</span>
                    <span style={{ color:"#c9d1e0" }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Risk tiers */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
              {Object.entries(RISK_TIERS).map(([tier, cfg]) => {
                const openInTier = positions.filter(p => p.tier === tier).length;
                return (
                  <div key={tier} style={{ background:"#0d1117", border:"1px solid #1a2535", borderRadius:6, padding:12 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                      <TierBadge tier={tier} />
                      <span style={{ fontSize:9, color:"#3d5470" }}>{openInTier}/{cfg.maxOpen} open</span>
                    </div>
                    <Bar value={cfg.allocation * 100} color={cfg.color} height={4} />
                    <div style={{ fontSize:8, color:"#3d5470", marginTop:6 }}>
                      SL -{cfg.sl*100}% · TP +{cfg.tp*100}%
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── ANALYTICS ── */}
        {activeTab === "analytics" && (
          <div>
            <div style={{ fontSize:9, color:"#3d5470", marginBottom:14 }}>PERFORMANCE ANALYTICS</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:14 }}>
              <StatCard label="EQUITY"       value={fmtUSD(equity)}    color="#fff" sub={`Started ${fmtUSD(STARTING_BALANCE)}`} />
              <StatCard label="CASH"         value={fmtUSD(cash)}      sub="Available to deploy" />
              <StatCard label="UNREALIZED"   value={`${totalUnrealized>=0?"+":""}${fmtUSD(totalUnrealized)}`} color={totalUnrealized>=0?"#00ff9d":"#ff4d6d"} sub={`${dayPnLPct}%`} />
              <StatCard label="TOTAL GAIN"   value={`${totalGain>=0?"+":""}${fmtUSD(totalGain)}`} color={totalGain>=0?"#00ff9d":"#ff4d6d"} sub="vs starting balance" />
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:14 }}>
              <StatCard label="OPEN POSITIONS" value={positions.length} sub={`of ${Object.values(RISK_TIERS).reduce((s,t)=>s+t.maxOpen,0)} max`} />
              <StatCard label="TOTAL TRADES"   value={(portfolio?.orders??[]).length} sub="All time" />
              <StatCard label="BOT RUNS"        value={portfolio?.lastRun ? "Active" : "Never"} color="#00ff9d" sub={portfolio?.lastRun ? new Date(portfolio.lastRun).toLocaleDateString() : "–"} />
              <StatCard label="RETURN %"        value={equity > 0 ? `${((equity/STARTING_BALANCE-1)*100).toFixed(2)}%` : "–"} color={equity >= STARTING_BALANCE ? "#00ff9d" : "#ff4d6d"} sub="since start" />
            </div>

            {/* Live data status */}
            <div style={{ background:"#0d1117", border:"1px solid #1a2535", borderRadius:8, padding:16 }}>
              <div style={{ fontSize:9, color:"#3d5470", marginBottom:12 }}>LIVE DATA SOURCES</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                {WATCHLIST.map(a => {
                  const q    = quoteData[a.symbol];
                  const tech = technicals[a.symbol];
                  return (
                    <div key={a.symbol} style={{ display:"flex", justifyContent:"space-between", fontSize:10, padding:"6px 0", borderBottom:"1px solid #1a2535" }}>
                      <span style={{ fontFamily:"'Orbitron',monospace", color:"#fff", fontSize:9 }}>{a.symbol}</span>
                      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                        <span style={{ color:q?"#00ff9d":"#3d5470", fontSize:8 }}>{q?"● LIVE":"○ MOCK"}</span>
                        {tech && <span style={{ color:"#5a7a9a", fontSize:8 }}>RSI {tech.rsi}</span>}
                        {q && <span style={{ color:q.change>=0?"#00ff9d":"#ff4d6d", fontSize:8, fontWeight:700 }}>{q.change>=0?"+":""}{q.change}%</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
