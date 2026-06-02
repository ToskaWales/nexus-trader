import { TASTY_BASE, YAHOO_BASE } from "../constants.js";

// ── BASE FETCH ────────────────────────────────────────────────────────────────

async function tastyFetch(path, { token, method = "GET", body } = {}) {
  const res = await fetch(`${TASTY_BASE}${path}`, {
    method,
    headers: {
      "Authorization":  token,
      "Content-Type":   "application/json",
      "User-Agent":     "nexus-trader/1.0",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || err.errors?.[0]?.title || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── AUTH ──────────────────────────────────────────────────────────────────────

export async function createSession(email, password) {
  const res = await fetch(`${TASTY_BASE}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "nexus-trader/1.0" },
    body: JSON.stringify({ login: email, password, "remember-me": false }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Login failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.data["session-token"];
}

export async function getAccountNumber(token) {
  const data = await tastyFetch("/customers/me/accounts", { token });
  const first = data.data.items?.[0]?.account;
  if (!first) throw new Error("No accounts found on this Tastytrade profile.");
  return first["account-number"];
}

// ── ACCOUNT ───────────────────────────────────────────────────────────────────

export async function getAccount({ token, accountNumber }) {
  const data = await tastyFetch(`/accounts/${accountNumber}/balances`, { token });
  const b = data.data;
  return {
    account_number:      accountNumber,
    equity:              b["margin-equity"]         ?? b["cash-balance"] ?? "0",
    buying_power:        b["equity-buying-power"]   ?? b["cash-balance"] ?? "0",
    long_market_value:   b["long-equity-value"]     ?? "0",
    short_market_value:  b["short-equity-value"]    ?? "0",
    initial_margin:      b["day-equity-call-value"] ?? "0",
    maintenance_margin:  b["maintenance-requirement"] ?? "0",
    currency:            "USD",
    status:              "ACTIVE",
    pattern_day_trader:  false,
    trading_blocked:     false,
    // unrealized_pl is filled in by refreshAll() after summing positions
    unrealized_pl:       "0",
    realized_pl:         b["realized-day-gain"] ?? "0",
  };
}

// ── POSITIONS ─────────────────────────────────────────────────────────────────

export async function getPositions({ token, accountNumber }) {
  const data = await tastyFetch(`/accounts/${accountNumber}/positions`, { token });
  return (data.data.items ?? []).map((p) => {
    const isLong   = p["quantity-direction"] === "Long";
    const qty      = parseFloat(p.quantity ?? 0);
    const entry    = parseFloat(p["average-open-price"] ?? 0);
    const current  = parseFloat(p["close-price"] ?? entry);
    const rawGain  = parseFloat(p["unrealized-gain"] ?? 0);
    const effect   = p["unrealized-gain-effect"]; // "Credit" | "Debit"
    const signedPL = effect === "Debit" ? -rawGain : rawGain;
    const costBasis = entry * qty;
    const plpc = costBasis > 0 ? (signedPL / costBasis).toFixed(6) : "0";
    return {
      symbol:            p.symbol,
      instrument_type:   p["instrument-type"],
      side:              isLong ? "long" : "short",
      qty:               p.quantity,
      avg_entry_price:   p["average-open-price"] ?? "0",
      current_price:     p["close-price"] ?? p["average-open-price"] ?? "0",
      unrealized_pl:     signedPL.toFixed(2),
      unrealized_plpc:   plpc,
    };
  });
}

// ── ORDERS ────────────────────────────────────────────────────────────────────

export async function getOrders({ token, accountNumber }) {
  const data = await tastyFetch(
    `/accounts/${accountNumber}/orders?per-page=20&sort=Desc`,
    { token }
  );
  return (data.data.items ?? []).map((o) => {
    const leg    = o.legs?.[0] ?? {};
    const action = (leg.action ?? "").toLowerCase();
    const side   = action.includes("buy") ? "buy" : "sell";
    const fills  = leg.fills ?? [];
    const filledPrice = fills.length
      ? (fills.reduce((sum, f) => sum + parseFloat(f["fill-price"] ?? 0) * parseFloat(f.quantity ?? 1), 0) /
         fills.reduce((sum, f) => sum + parseFloat(f.quantity ?? 1), 0)).toFixed(2)
      : null;
    return {
      id:               String(o.id),
      symbol:           leg.symbol ?? o.symbol ?? "",
      side,
      qty:              leg.quantity ?? o.quantity ?? "0",
      type:             (o["order-type"] ?? "market").toLowerCase(),
      filled_avg_price: filledPrice,
      limit_price:      o.price ? String(o.price) : null,
      status:           (o.status ?? "").toLowerCase(),
      created_at:       o["received-at"] ?? o["created-at"] ?? new Date().toISOString(),
    };
  });
}

// ── PLACE ORDER ───────────────────────────────────────────────────────────────

export async function placeOrder({ token, accountNumber }, { symbol, qty, side, instrumentType }) {
  const isCrypto  = instrumentType === "Cryptocurrency";
  const actionMap = { buy: "Buy to Open", sell: "Sell to Open" };
  return tastyFetch(`/accounts/${accountNumber}/orders`, {
    token,
    method: "POST",
    body: {
      "order-type":    "Market",
      "time-in-force": isCrypto ? "IOC" : "Day",
      legs: [{
        "instrument-type": instrumentType,
        symbol,
        quantity:          String(qty),
        action:            actionMap[side] ?? "Buy to Open",
      }],
    },
  });
}

export async function closePosition({ token, accountNumber }, position) {
  const isLong    = position.side === "long";
  const isCrypto  = position.instrument_type === "Cryptocurrency";
  return tastyFetch(`/accounts/${accountNumber}/orders`, {
    token,
    method: "POST",
    body: {
      "order-type":    "Market",
      "time-in-force": isCrypto ? "IOC" : "Day",
      legs: [{
        "instrument-type": position.instrument_type,
        symbol:            position.symbol,
        quantity:          position.qty,
        action:            isLong ? "Sell to Close" : "Buy to Close",
      }],
    },
  });
}

// ── MARKET DATA (Yahoo Finance, no API key needed) ────────────────────────────

export async function fetchPrices(symbols) {
  const results = {};
  await Promise.all(
    symbols.map(async (sym) => {
      // Yahoo Finance uses BTC-USD format instead of BTC/USD
      const yahooSym = sym.replace("/", "-");
      try {
        const res = await fetch(`${YAHOO_BASE}/v8/finance/chart/${yahooSym}?interval=1m&range=1d`);
        if (!res.ok) return;
        const data  = await res.json();
        const meta  = data.chart?.result?.[0]?.meta;
        if (!meta?.regularMarketPrice) return;
        const price  = meta.regularMarketPrice;
        const prev   = meta.chartPreviousClose ?? price;
        const change = +((price - prev) / prev * 100).toFixed(2);
        results[sym] = { price, change };
      } catch { /* fallback to mock */ }
    })
  );
  return results;
}
