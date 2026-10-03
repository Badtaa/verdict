// Live NQ / ES futures quotes for the app, plus the tape check against the current call.
// Yahoo's chart API first (price, time and 5-minute bars), Google Finance as a price-only fallback.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

async function yahoo(sym) {
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=5m&range=1d&includePrePost=true`, {
        headers: { "user-agent": UA, accept: "application/json" },
      });
      if (!r.ok) continue;
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      const m = res?.meta;
      if (!m || m.regularMarketPrice == null) continue;
      const ts = res.timestamp || [], q = res.indicators?.quote?.[0] || {};
      const bars = [];
      ts.forEach((t, i) => {
        const h = q.high?.[i], l = q.low?.[i];
        if (h != null && l != null) bars.push([t * 1000, +h.toFixed(2), +l.toFixed(2)]);
      });
      return {
        price: m.regularMarketPrice,
        time: m.regularMarketTime ? m.regularMarketTime * 1000 : null,
        prevClose: m.chartPreviousClose ?? m.previousClose ?? null,
        dayHigh: m.regularMarketDayHigh ?? null,
        dayLow: m.regularMarketDayLow ?? null,
        bars,
        src: "Yahoo",
      };
    } catch { /* try the next host */ }
  }
  return null;
}

async function google(code) {
  try {
    const r = await fetch(`https://www.google.com/finance/quote/${code}?hl=en`, { headers: { "user-agent": UA } });
    if (!r.ok) return null;
    const h = await r.text();
    const p = h.match(/data-last-price="([\d.]+)"/);
    const t = h.match(/data-last-normal-market-timestamp="(\d+)"/);
    if (!p) return null;
    return { price: Number(p[1]), time: t ? Number(t[1]) * 1000 : Date.now(), prevClose: null, dayHigh: null, dayLow: null, bars: [], src: "Google" };
  } catch {
    return null;
  }
}

let cache = null;
export async function getQuotes() {
  if (cache && Date.now() - cache.at < 25e3) return cache;
  const [NQ, ES] = await Promise.all([
    yahoo("NQ=F").then(x => x || google("NQW00:CME_EMINIS")),
    yahoo("ES=F").then(x => x || google("ESW00:CME_EMINIS")),
  ]);
  if (!NQ) throw new Error("No live price right now");
  cache = { ok: true, at: Date.now(), NQ, ES };
  return cache;
}

// Same rule the news watcher uses: T = half the expected AM move.
// Against = price moved more than T against the call since it was made, or (REVERSAL) fell more
// than T off the high made since the call (bullish call) / rose more than T off the low (bearish call).
export function tapeRead(br, q) {
  const n = q?.NQ;
  if (!br || !n || n.price == null) return null;
  const bias = br.instruments?.NQ?.bias || "neutral";
  const am = Number(br.implied?.NQ?.amMovePct);
  const T = am > 0 ? 0.5 * am : 0.35;
  const calls = br.calls || [];
  const c = calls[calls.length - 1];
  const ref = Number(c?.px?.NQ) || null;
  const since = c?.at ? Date.parse(c.at) : 0;
  const mv = ref ? (n.price - ref) / ref * 100 : null;
  let hi = n.price, lo = n.price;
  (n.bars || []).forEach(([t, h, l]) => { if (t >= since - 5 * 60e3) { if (h > hi) hi = h; if (l < lo) lo = l; } });
  const offHi = (hi - n.price) / hi * 100, offLo = (n.price - lo) / lo * 100;
  const f = x => Number(x).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const p = x => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(2) + "%";
  let state = "with", why = mv != null ? `${p(mv)} since the call` : "", lean = bias;
  if (bias === "bullish") {
    if (mv != null && mv < -T) { state = "against"; why = `${p(mv)} since the call`; lean = "bearish"; }
    else if (offHi > T) { state = "against"; why = `${p(-offHi)} off the ${f(hi)} high`; lean = "bearish"; }
  } else if (bias === "bearish") {
    if (mv != null && mv > T) { state = "against"; why = `${p(mv)} since the call`; lean = "bullish"; }
    else if (offLo > T) { state = "against"; why = `${p(offLo)} off the ${f(lo)} low`; lean = "bullish"; }
  } else if (mv != null && Math.abs(mv) > T) {
    state = "breakout"; why = `${p(mv)} since the call`; lean = mv > 0 ? "bullish" : "bearish";
  } else {
    state = "flat";
  }
  return { state, why, lean, T: +T.toFixed(2), mv, hi, lo, price: n.price, time: n.time, bias, callAt: c?.at || null };
}

export function futuresOpen(d = new Date()) {
  const p = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, weekday: "short", hour: "2-digit" })
    .formatToParts(d).forEach(x => { p[x.type] = x.value; });
  const h = Number(p.hour) % 24, wd = p.weekday;
  if (wd === "Sat") return false;
  if (wd === "Sun") return h >= 18;
  if (wd === "Fri") return h < 17;
  return h !== 17;
}
