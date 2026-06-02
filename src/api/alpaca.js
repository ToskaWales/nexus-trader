import { PAPER_BASE, DATA_BASE } from "../constants.js";
import { toAlpaca, toDisplay } from "../utils/symbol.js";

async function alpaca(path, { keys, method = "GET", body } = {}) {
  const res = await fetch(`${PAPER_BASE}${path}`, {
    method,
    headers: {
      "APCA-API-KEY-ID":     keys.id,
      "APCA-API-SECRET-KEY": keys.secret,
      "Content-Type":        "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export const getAccount   = (keys) => alpaca("/v2/account", { keys });
export const getPositions = (keys) => alpaca("/v2/positions", { keys });
export const getOrders    = (keys) => alpaca("/v2/orders?status=all&limit=20", { keys });

export function placeOrder(keys, { symbol, qty, side, type = "market", time_in_force = "gtc" }) {
  return alpaca("/v2/orders", {
    keys,
    method: "POST",
    body: { symbol: toAlpaca(symbol), qty: String(qty), side, type, time_in_force },
  });
}

export function closePosition(keys, symbol) {
  return alpaca(`/v2/positions/${toAlpaca(symbol)}`, { keys, method: "DELETE" });
}

export async function fetchSnapshots(keys, symbols) {
  const stockSyms  = symbols.filter((s) => !s.includes("/"));
  const cryptoSyms = symbols.filter((s) => s.includes("/")).map(toAlpaca);
  const results = {};

  const headers = {
    "APCA-API-KEY-ID":     keys.id,
    "APCA-API-SECRET-KEY": keys.secret,
  };

  if (stockSyms.length) {
    try {
      const url = `${DATA_BASE}/v2/stocks/snapshots?symbols=${stockSyms.join(",")}&feed=iex`;
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json();
        for (const [sym, snap] of Object.entries(data)) {
          const price = snap.latestTrade?.p ?? snap.minuteBar?.c ?? null;
          const prev  = snap.prevDailyBar?.c ?? price;
          const change = price && prev ? +((price - prev) / prev * 100).toFixed(2) : 0;
          if (price) results[sym] = { price, change };
        }
      }
    } catch { /* fallback to mock */ }
  }

  if (cryptoSyms.length) {
    try {
      const url = `${DATA_BASE}/v1beta3/crypto/us/snapshots?symbols=${cryptoSyms.join(",")}`;
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json();
        for (const [alpacaSym, snap] of Object.entries(data.snapshots ?? {})) {
          const displaySym = toDisplay(alpacaSym);
          const price = snap.latestTrade?.p ?? snap.minuteBar?.c ?? null;
          const prev  = snap.prevDailyBar?.c ?? price;
          const change = price && prev ? +((price - prev) / prev * 100).toFixed(2) : 0;
          if (price) results[displaySym] = { price, change };
        }
      }
    } catch { /* fallback to mock */ }
  }

  return results;
}
