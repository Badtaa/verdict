import { yfetch } from "./server.js";
// Multi-asset tape + top NQ weights from Yahoo's chart API (price, change vs prior close, a small spark).
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
export const MACRO = [
  ["NQ", "NQ=F"], ["ES", "ES=F"], ["10Y", "^TNX"], ["DXY", "DX-Y.NYB"], ["WTI", "CL=F"], ["VIX", "^VIX"], ["Gold", "GC=F"], ["BTC", "BTC-USD"],
];
export const WEIGHTS = [
  ["NVDA", "NVDA"], ["MSFT", "MSFT"], ["AAPL", "AAPL"], ["AMZN", "AMZN"], ["META", "META"], ["AVGO", "AVGO"], ["GOOGL", "GOOGL"], ["TSLA", "TSLA"],
];

async function one(label, sym) {
  for (const host of ["query1", "query2"]) {
    try {
      const r = await yfetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=5m&range=1d&includePrePost=true`, {
        headers: { "user-agent": UA, accept: "application/json" },
      });
      if (!r.ok) continue;
      const j = await r.json();
      const res = j?.chart?.result?.[0], m = res?.meta;
      if (!m || m.regularMarketPrice == null) continue;
      const closes = (res.indicators?.quote?.[0]?.close || []).filter(v => v != null);
      const last = closes.length ? closes[closes.length - 1] : m.regularMarketPrice;
      const prev = m.chartPreviousClose ?? m.previousClose ?? null;
      const step = Math.max(1, Math.floor(closes.length / 32));
      const spark = closes.filter((_, i) => i % step === 0).concat(closes.length ? [last] : []).map(v => +v.toFixed(4));
      return { k: label, sym, price: +last, prev, chg: prev ? (last - prev) / prev * 100 : null, time: m.regularMarketTime ? m.regularMarketTime * 1000 : null, spark };
    } catch { /* next host */ }
  }
  return null;
}

let cache = null;
export async function getTape() {
  if (cache && Date.now() - cache.at < 45e3) return cache;
  const all = await Promise.all([...MACRO, ...WEIGHTS].map(([k, s]) => one(k, s)));
  const macro = all.slice(0, MACRO.length).filter(Boolean), weights = all.slice(MACRO.length).filter(Boolean);
  if (!macro.length && !weights.length) { if (cache) return cache; throw new Error("No prices right now"); }
  cache = { ok: true, at: Date.now(), src: "Yahoo", macro, weights };
  return cache;
}
