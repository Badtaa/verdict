// Live bias engine. Runs on the server every couple of minutes (pg_cron → /api/push-tick), costs nothing,
// and keeps the call moving between Claude's full reads:
//  1. Re-scores the market-driven rubric factors (yields, dollar, vol, oil, futures trend, gamma, global)
//     from live Yahoo quotes, using exactly the brief's thresholds, and carries the slow factors
//     (Fed odds, data surprise, COT, geopolitics, news) from the latest read.
//  2. Reads short-term "pressure": what rates, the dollar, vol, momentum and fresh news did in the last
//     30–60 minutes. These usually move before NQ does.
//  3. Flags a flip when the live call disagrees with the last full read two runs in a row.
import { rest, yfetch } from "./server.js";
import { getCalendar } from "./calendar.js";
import { getQuotes } from "./quote.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const SYMS = { NQ: "NQ=F", ES: "ES=F", TNX: "^TNX", Y2: "2YY=F", DXY: "DX-Y.NYB", VXN: "^VXN", VIX: "^VIX", VIX3M: "^VIX3M", WTI: "CL=F", ZN: "ZN=F", SMH: "SMH", GOLD: "GC=F", N225: "^N225", DAX: "^GDAXI" };

async function chart(sym) {
  for (const host of ["query1", "query2"]) {
    try {
      const r = await yfetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=5m&range=1d&includePrePost=true`, { headers: { "user-agent": UA, accept: "application/json" } });
      if (!r.ok) continue;
      const j = await r.json(); const res = j?.chart?.result?.[0], m = res?.meta;
      if (!m || m.regularMarketPrice == null) continue;
      const ts = res.timestamp || [], q = res.indicators?.quote?.[0] || {};
      const bars = []; ts.forEach((t, i) => { const c = q.close?.[i], h = q.high?.[i], l = q.low?.[i]; if (c != null) bars.push({ t: t * 1000, c, h: h ?? c, l: l ?? c }); });
      const last = bars.length ? bars[bars.length - 1].c : m.regularMarketPrice;
      return { price: last, prev: m.chartPreviousClose ?? m.previousClose ?? null, time: (m.regularMarketTime || 0) * 1000, bars };
    } catch { /* next host */ }
  }
  return null;
}
const pctChg = q => q && q.prev ? (q.price - q.prev) / q.prev * 100 : null;
const y = v => v > 20 ? v / 10 : v;                       // ^TNX quoted ×10 on some feeds
const bpChg = q => q && q.prev != null ? (y(q.price) - y(q.prev)) * 100 : null;
function ago(q, mins) {                                      // value about `mins` ago from 5-minute bars
  if (!q?.bars?.length) return null; const t = q.bars[q.bars.length - 1].t - mins * 60e3;
  let b = null; for (const x of q.bars) { if (x.t <= t) b = x; else break; } return b ? b.c : null;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = v => v == null || !isFinite(v) ? null : Math.round(v * 100) / 100;

function etParts(d = new Date()) {
  const p = {}; new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" })
    .formatToParts(d).forEach(x => { p[x.type] = x.value; });
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, wd: p.weekday };
}
export function futuresOpen(d = new Date()) {
  const p = etParts(d); if (p.wd === "Sat") return false; if (p.wd === "Sun") return p.h >= 18; if (p.wd === "Fri") return p.h < 17; return p.h !== 17;
}
// Session date: after 18:00 ET (and on weekends) the next weekday, otherwise today.
export function sessionDate(d = new Date()) {
  const p = etParts(d); let dt = new Date(Date.UTC(p.y, p.m - 1, p.d, 12));
  const step = () => { dt = new Date(dt.getTime() + 864e5); };
  if (p.h >= 18) step();
  while ([0, 6].includes(dt.getUTCDay())) step();
  return dt.toISOString().slice(0, 10);
}

// Rubric thresholds, copied from the brief prompt.
const sc10y = (bp, k) => bp == null ? null : bp <= -5 * k ? 2 : bp <= -2 * k ? 1 : bp < 2 * k ? 0 : bp < 5 * k ? -1 : -2;
const scDxy = p => p == null ? null : p <= -0.4 ? 2 : p <= -0.15 ? 1 : p < 0.15 ? 0 : p < 0.4 ? -1 : -2;
function scVol(chg, vix, vix3m) { if (chg == null) return null; let s = chg > 5 ? -1 : chg < -5 ? 1 : 0; if (vix != null && vix3m != null && vix > vix3m) s -= 1; return clamp(s, -2, 2); }
const scWti = (p, sym) => p == null ? null : sym === "ES" ? 0 : p >= 2 ? -1 : p <= -2 ? 1 : 0;
const scTrend = p => p == null ? null : p >= 0.5 ? 1 : p <= -0.5 ? -1 : 0;
const scGlobal = (n, d) => n == null || d == null ? null : n >= 0.5 && d >= 0.5 ? 1 : n <= -0.5 && d <= -0.5 ? -1 : 0;
function scGamma(spot, P, inp) {
  const n = v => v !== "" && v != null && isFinite(Number(v)) ? Number(v) : null;
  const flip = n(inp?.flip) ?? n(P?.flip), cw = n(inp?.callWall) ?? n(P?.callWall), pw = n(inp?.putWall) ?? n(P?.putWall);
  const pos = (inp?.gex || P?.regime) === "positive";
  if (spot == null || flip == null) return null;
  let s; if (Math.abs(spot - flip) / flip < 0.0015) s = 0; else s = spot > flip && pos ? 1 : -1;
  if (pos && pw != null && spot >= pw && (spot - pw) / pw <= 0.003) s += 1;
  if (cw != null && spot <= cw && (cw - spot) / cw <= 0.003) s -= 1;
  return { pts: clamp(s, -2, 2), txt: `${Math.round(spot)} vs flip ${Math.round(flip)}${cw ? `, call wall ${Math.round(cw)}` : ""}${pw ? `, put wall ${Math.round(pw)}` : ""} (${pos ? "positive" : "negative"} gamma)`, between: pos && cw != null && pw != null && spot > pw && spot < cw };
}
function scAuction(spot, inp) {
  const vah = Number(inp?.vah), val = Number(inp?.val); if (!vah || !val || spot == null) return null;
  return spot > vah ? 1 : spot < val ? -1 : 0;
}
const W8 = { high: 1, medium: 0.5, low: 0 };
function scNews(news, sym, since) {
  const k = sym.toLowerCase(); let s = 0, n = 0;
  (news || []).forEach(x => { if (x.category === "geopolitics" || Date.parse(x.at) < since) return; const w = W8[x.impact] || 0; if (!w || !x[k]) return; s += x[k] * w; n++; });
  return { pts: clamp(Math.round(s), -2, 2), n, sum: s };
}

function rubricFor(sym, Q, br, inp, since, carried) {
  const k = sym === "ES" ? 1.5 : 1;
  const old = {}; (br?.instruments?.[sym]?.rubric || []).forEach(f => { old[f.factor] = f; });
  // Day-specific factors don't carry over from an older read; weekly/slow ones do (marked with their date).
  const DAILY = ["Fed odds shift", "Data surprise", "News", "Auction", "Dealer gamma"];
  const keep = name => carried && DAILY.includes(name)
    ? { factor: name, points: 0, input: `No full read yet for this session (last read ${carried})`, live: false, stale: true }
    : { factor: name, points: Number(old[name]?.points) || 0, input: (carried ? `From the ${carried} read: ` : "") + (old[name]?.input || "n/a"), live: false, stale: !!carried };
  const live = (name, pts, input) => pts == null ? keep(name) : { factor: name, points: pts, input, live: true, was: old[name] ? Number(old[name].points) || 0 : null };
  const tnx = bpChg(Q.TNX), y2 = bpChg(Q.Y2), dxy = pctChg(Q.DXY), vol = sym === "NQ" ? Q.VXN : Q.VIX, volChg = pctChg(vol), wti = pctChg(Q.WTI);
  const fut = Q[sym], futChg = pctChg(fut), nik = pctChg(Q.N225), dax = pctChg(Q.DAX);
  const g = carried ? null : scGamma(fut?.price, br?.positioning?.[sym], inp?.[sym]);
  const news = scNews(br?.news, sym, since);
  const f = [
    live("10Y change", sc10y(tnx, k), tnx != null ? `${tnx >= 0 ? "+" : ""}${tnx.toFixed(1)} bp to ${y(Q.TNX.price).toFixed(3)}% (live)` : ""),
    live("2Y change", sc10y(y2, k), y2 != null ? `${y2 >= 0 ? "+" : ""}${y2.toFixed(1)} bp (live)` : ""),
    live("DXY", scDxy(dxy), dxy != null ? `${Q.DXY.price.toFixed(2)}, ${dxy >= 0 ? "+" : ""}${dxy.toFixed(2)}% (live)` : ""),
    live("Volatility", scVol(volChg, Q.VIX?.price, Q.VIX3M?.price), volChg != null ? `${sym === "NQ" ? "VXN" : "VIX"} ${vol.price.toFixed(2)}, ${volChg >= 0 ? "+" : ""}${volChg.toFixed(1)}%${Q.VIX && Q.VIX3M ? `; VIX ${Q.VIX.price > Q.VIX3M.price ? "above" : "below"} VIX3M` : ""} (live)` : ""),
    keep("Fed odds shift"),
    keep("Data surprise"),
    live("WTI", scWti(wti, sym), wti != null ? `${Q.WTI.price.toFixed(2)}, ${wti >= 0 ? "+" : ""}${wti.toFixed(2)}% (live)` : ""),
    live("Futures trend", scTrend(futChg), futChg != null ? `${sym} ${Math.round(fut.price).toLocaleString("en-US")}, ${futChg >= 0 ? "+" : ""}${futChg.toFixed(2)}% vs settle (live)` : ""),
    news.n ? live("News", news.pts, `${news.n} scored headlines today, net ${news.sum >= 0 ? "+" : ""}${news.sum.toFixed(1)} (live)`) : keep("News"),
    g ? live("Dealer gamma", g.pts, g.txt + " (live price)") : keep("Dealer gamma"),
    keep("COT positioning"),
    (() => { const a = scAuction(fut?.price, inp?.[sym]); return a == null ? keep("Auction") : live("Auction", a, "vs your prior value area (live price)"); })(),
    live("Global overnight", scGlobal(nik, dax), nik != null && dax != null ? `Nikkei ${nik >= 0 ? "+" : ""}${nik.toFixed(2)}%, DAX ${dax >= 0 ? "+" : ""}${dax.toFixed(2)}% (live)` : ""),
    keep("Geopolitics"),
  ];
  const sum = f.reduce((a, x) => a + (Number(x.points) || 0), 0);
  const score = clamp(Math.round(sum / 28 * 100), -100, 100);
  const bias = score >= 15 ? "bullish" : score <= -15 ? "bearish" : "neutral";
  let conv = Math.abs(score) < 25 ? 0 : Math.abs(score) <= 50 ? 1 : 2;
  if (g?.between) conv = Math.max(0, conv - 1);
  return { score, bias, conviction: ["low", "medium", "high"][conv], rubric: f, livePts: f.filter(x => x.live).length };
}

// Short-term pressure: a "turn" model fitted on 60 days of 5-minute data (RTH, Aug–Oct 2026) and checked
// on a held-out half. What actually led NQ's next 30–60 minutes:
//   bonds up / yields down (ZN futures)  → NQ up      (strongest, corr ≈ +0.14 both halves)
//   oil up                               → NQ down    (≈ −0.09)
//   dollar up                            → NQ down    (≈ −0.05)
//   VIX up                               → NQ UP next (fear spikes get faded, ≈ +0.09 at 60 min)
//   chips (SMH) outrunning NQ            → NQ down    (stretch snaps back, ≈ −0.17 at 60 min)
//   NQ's own 30-min move                 → mild reversal (≈ −0.07)
// Held-out result: top 20% of scores → NQ higher 30 min later 63–65% of the time (avg ≈ +0.09%);
// bottom 20% → lower about 52–55%. Bullish turns are the more reliable side in this sample.
const TURN = { zn: [0.149, 0.0435], cl: [-0.110, 0.4232], dx: [-0.063, 0.0562], vix: [0.094, 0.1804], smh: [-0.180, 0.3111], nq: [-0.098, 0.2172] };
const TURN_STATS = { up: "63–65% of past signals saw NQ higher 30–60 min later", dn: "past bearish signals worked about 53% of the time" };
function etMin(d = new Date()) { const p = etParts(d); return p.h * 60 + p.mi; }
function pressure(Q, br, T, cal, M) {
  // M = the latest self-refit (model_weights row, refit every weekday after the close on the last 60 days).
  // Falls back to the fixed turn-v1 weights if the refit isn't there.
  const W = M?.weights || null, ST = M?.stats || null;
  const wt = k => W ? [Number(W[k]?.[0]) || 0, Number(W[k]?.[1]) || 1] : TURN[k];
  const s = []; let sc = 0;
  const ch = (q, m = 30) => { const a = ago(q, m); return q && a ? (q.price / a - 1) * 100 : null; };
  const unit = ST ? Math.max(0.02, (Number(ST.p80) - Number(ST.p20)) / 4) : 0.13;
  // One factor can't carry the call on its own: each is capped at ±2.5 units (a stale print or a gap can't fire a strong signal).
  const add = (k, v, w, txt) => { if (v == null || !isFinite(v)) return; const [a, sd] = wt(w); if (!a) return; const c = Math.max(-2.5 * unit, Math.min(2.5 * unit, a * v / sd)); sc += c; if (Math.abs(c) >= unit * 0.6) s.push({ k, pts: Math.round(c / unit * 10) / 10, txt }); };
  const mNow = etMin(), cashWarm = mNow >= 600 && mNow < 960;   // stock-based factors need a full 30 min of cash-session prints (10:00+)
  const zn = ch(Q.ZN), cl = ch(Q.WTI), dx = ch(Q.DXY), nq = ch(Q.NQ), smh = ch(Q.SMH);
  const vixA = Q.VIX ? ago(Q.VIX, 30) : null, vix = Q.VIX && vixA != null ? Q.VIX.price - vixA : null;
  const dirOf = k => (wt(k)[0] || 0);
  add("Bonds", zn, "zn", zn == null ? "" : `Bonds ${zn > 0 ? "up, yields falling" : "down, yields rising"} (${zn > 0 ? "+" : ""}${zn.toFixed(2)}% in 30 min)`);
  add("Oil", cl, "cl", cl == null ? "" : `Oil ${cl > 0 ? "+" : ""}${cl.toFixed(2)}% in 30 min`);
  add("Dollar", dx, "dx", dx == null ? "" : `Dollar ${dx > 0 ? "+" : ""}${dx.toFixed(2)}% in 30 min`);
  add("VIX", vix, "vix", vix == null ? "" : dirOf("vix") > 0 ? (vix > 0 ? `VIX +${vix.toFixed(2)}: fear spikes are getting faded` : `VIX ${vix.toFixed(2)}: complacency, upside fading`) : `VIX ${vix > 0 ? "+" : ""}${vix.toFixed(2)} in 30 min`);
  if (cashWarm && smh != null && nq != null) add("Chips", smh - nq, "smh", `Chips ${smh - nq > 0 ? "ran ahead of" : "lagging"} NQ by ${Math.abs(smh - nq).toFixed(2)}%${dirOf("smh") < 0 ? `: ${smh - nq > 0 ? "stretched" : "room to catch up"}` : ""}`);
  add("Stretch", nq, "nq", nq == null ? "" : `NQ ${nq > 0 ? "+" : ""}${nq.toFixed(2)}% in 30 min${dirOf("nq") < 0 ? `: ${nq > 0 ? "extended" : "washed out"}` : ""}`);
  const since = Date.now() - 60 * 60e3; let ns = 0, nn = 0;
  (br?.news || []).forEach(x => { if (Date.parse(x.at) < since) return; const w = { high: 1, medium: 0.5 }[x.impact] || 0; if (w && x.nq) { ns += x.nq * w; nn++; } });
  if (nn && Math.abs(ns) >= 0.5) { const c = Math.sign(ns) * unit * 1.1; sc += c; s.push({ k: "Headlines", pts: 1.1 * Math.sign(ns), txt: `${nn} headline${nn === 1 ? "" : "s"} in the last hour lean ${ns > 0 ? "bullish" : "bearish"}` }); }
  s.sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts));
  const m = etMin(), rth = m >= 570 && m < 960;
  const score = Math.round(sc / unit);              // ±2 ≈ top/bottom 20% of the last 60 days
  const lean = ST ? (sc >= Number(ST.p80) ? "bullish" : sc <= Number(ST.p20) ? "bearish" : "neutral") : (score >= 2 ? "bullish" : score <= -2 ? "bearish" : "neutral");
  const strongHit = ST ? (lean === "bullish" ? sc >= Number(ST.p90) : lean === "bearish" ? sc <= Number(ST.p10) : false) : Math.abs(score) >= 4;
  const now = Date.now();
  const ev = (cal?.events || []).filter(e => e.country === "USD" && e.impact === "high" && e.t > now && e.t - now <= 45 * 60e3);
  const event = ev.length ? { title: ev[0].title + (ev.length > 1 ? ` +${ev.length - 1}` : ""), t: ev[0].t } : null;
  const odds = !ST ? (lean === "bullish" ? TURN_STATS.up : lean === "bearish" ? TURN_STATS.dn : null)
    : lean === "bullish" ? `${strongHit ? ST.upStrong : ST.up}% of signals like this saw NQ higher 30 min later (last 60 days)`
    : lean === "bearish" ? `${strongHit ? ST.dnStrong : ST.dn}% of signals like this saw NQ lower 30 min later (last 60 days)` : null;
  const openRush = m >= 565 && m < 585;            // 9:25–9:45: the open's first swings aren't a turn signal
  return { score, raw: Math.round(sc * 1000) / 1000, lean, strong: rth && strongHit && !event && !openRush, rth, openRush, model: ST ? "turn-v2 (self-refit)" : "turn-v1",
    fitAt: M?.at || null, odds, signals: s, event };
}

// After the 8:30 data, the first hour's reaction tends to hold. 2 years of hourly data (May 2024–Oct 2026):
// NQ moves >0.4% between 8:00 and 9:00 ET → same direction at the 4 PM close 57% of the time;
// when bonds confirm it (yields falling with NQ up, or rising with NQ down) → 74% (38 days);
// when bonds disagree, NQ's own direction still won about 2 out of 3 times.
function reaction(Q) {
  const p = etParts(); const m = p.h * 60 + p.mi; if (m < 540 || m >= 960 || !Q.NQ?.bars?.length) return null;
  const at = (q, hh) => { if (!q?.bars?.length) return null; const day = new Date(); let best = null;
    for (const b of q.bars) { const e = etParts(new Date(b.t)); if (e.d !== p.d) continue; if (e.h * 60 + e.mi <= hh * 60) best = b.c; } return best; };
  const n8 = at(Q.NQ, 8), n9 = at(Q.NQ, 9), z8 = at(Q.ZN, 8), z9 = at(Q.ZN, 9);
  if (!n8 || !n9) return null;
  const r = (n9 / n8 - 1) * 100; if (Math.abs(r) < 0.4) return null;
  const zr = z8 && z9 ? (z9 / z8 - 1) * 100 : null;
  const bonds = zr == null || Math.abs(zr) < 0.05 ? "flat" : Math.sign(zr) === Math.sign(r) ? "confirm" : "against";
  const dir = r > 0 ? "bullish" : "bearish";
  return { dir, pct: Math.round(r * 100) / 100, bonds, odds: bonds === "confirm" ? 74 : bonds === "against" ? 64 : 57,
    txt: `Data reaction: NQ ${r > 0 ? "+" : ""}${r.toFixed(2)}% from 8 to 9 AM${bonds === "confirm" ? ", bonds confirming" : bonds === "against" ? ", bonds disagree" : ""}` };
}

export async function runEngine({ force } = {}) {
  if (!force && !futuresOpen()) return { skipped: "closed" };
  const keys = Object.keys(SYMS);
  const got = [];
  for (let i = 0; i < keys.length; i += 4) got.push(...await Promise.all(keys.slice(i, i + 4).map(k => chart(SYMS[k]).then(x => x || chart(SYMS[k])))));
  const Q = {}; keys.forEach((k, i) => { if (got[i]) Q[k] = got[i]; });
  if (!Q.NQ || !Q.ES) {            // Yahoo hiccup: fall back to the site's quote feed (Yahoo → Google)
    try { const g = await getQuotes(); for (const k of ["NQ", "ES"]) if (!Q[k] && g[k]?.price != null) Q[k] = { price: g[k].price, prev: g[k].prevClose ?? null, time: g[k].time, bars: (g[k].bars || []).map(b => ({ t: b[0], c: (b[1] + b[2]) / 2, h: b[1], l: b[2] })) }; } catch {}
  }
  if (!Q.NQ) return { skipped: "no NQ quote", missing: keys.filter(k => !Q[k]) };

  const id = sessionDate();
  const rows = await rest(`briefs?select=id,data&id=lte.${id}&order=id.desc&limit=1`);
  const row = rows?.[0], br = row?.data || {};
  const inpRows = await rest(`inputs?select=data&id=eq.${row?.id || id}`).catch(() => []);
  const inp = inpRows?.[0]?.data || {};
  let cal = null; try { cal = await getCalendar(); } catch { /* optional */ }

  // News window starts at the most recent 4pm ET close.
  const p = etParts(); const today = new Date(Date.UTC(p.y, p.m - 1, p.d, 12));
  const closeDay = p.h >= 16 ? today : new Date(today.getTime() - 864e5);
  const since = Date.parse(closeDay.toISOString().slice(0, 10) + "T20:00:00Z");
  const carried = row?.id && row.id !== id ? row.id : null;
  const NQ = rubricFor("NQ", Q, br, inp, since, carried), ES = rubricFor("ES", Q, br, inp, since, carried);
  const am = Number(br?.implied?.NQ?.amMovePct); const T = am > 0 ? 0.5 * am : 0.35;
  const mw = await rest("model_weights?select=at,weights,stats&order=id.desc&limit=1").catch(() => null);
  const press = pressure(Q, br, T, cal, mw?.[0]);
  const react = reaction(Q);

  // A high-impact US release still ahead before 9:30 caps conviction at low (brief rule).
  const pend = (cal?.events || []).some(e => e.country === "USD" && e.impact === "high" && e.t > Date.now() && etParts(new Date(e.t)).h < 10 && sessionDate(new Date(e.t)) === id);
  if (pend) { NQ.conviction = "low"; ES.conviction = "low"; }

  const calls = br?.calls || [], last = calls[calls.length - 1];
  const prevRows = await rest(`live?select=data&id=eq.${id}`).catch(() => []);
  const prev = prevRows?.[0]?.data || {};
  const hist = (prev.history || []).filter(h => Date.now() - h.t < 20 * 3600e3);
  hist.push({ t: Date.now(), px: Math.round(Q.NQ.price * 4) / 4, nq: NQ.score, es: ES.score, pr: press.score });
  while (hist.length > 720) hist.shift();   // a full futures session (6 PM–4 PM) at 2-minute steps

  // Flip: live NQ bias differs from the last full read for two runs in a row.
  const readBias = last?.NQ?.bias || br?.instruments?.NQ?.bias || null;
  const diff = readBias && NQ.bias !== readBias;
  const streak = diff ? (prev.flip?.bias === NQ.bias ? (prev.flip.n || 0) + 1 : 1) : 0;
  const flip = diff ? { bias: NQ.bias, n: streak, since: prev.flip?.bias === NQ.bias ? prev.flip.since : new Date().toISOString(), from: readBias } : null;

  const quotes = {}; keys.forEach(k => { if (Q[k]) quotes[k] = { price: r2(k === "TNX" ? y(Q[k].price) : Q[k].price), chg: r2(k === "TNX" || k === "Y2" ? bpChg(Q[k]) : pctChg(Q[k])), unit: k === "TNX" || k === "Y2" ? "bp" : "%" }; });
  const nqBars = Q.NQ.bars; const sessHi = Math.max(...nqBars.map(b => b.h)), sessLo = Math.min(...nqBars.map(b => b.l));
  const data = {
    at: new Date().toISOString(), session: id, briefId: row?.id || null, carried: row?.id && row.id !== id ? row.id : null,
    NQ, ES, pressure: press, reaction: react, hlStats: await rest("rpc/hl_stats", { method: "POST", body: {} }).catch(() => null), turnStats: await rest("rpc/turn_stats", { method: "POST", body: {} }).catch(() => null), quotes, T: Math.round(T * 100) / 100,
    nq: { price: Q.NQ.price, prev: Q.NQ.prev, hi: sessHi, lo: sessLo },
    read: last ? { at: last.at, phase: last.phase, NQ: last.NQ, ES: last.ES } : null,
    flip, history: hist,
    flagged: prev.flagged || null, pushed: prev.pushed || null,
  };

  const out = { id, nq: NQ.score, bias: NQ.bias, pressure: press.score, flip: flip?.n || 0 };
  // Confirmed flip (2 runs): flag the brief, queue a full rescore for the next Claude check.
  if (flip && flip.n >= 2 && row?.id === id && data.flagged !== flip.since) {
    const top = NQ.rubric.filter(x => x.live && x.was != null && x.points !== x.was).sort((a, b) => Math.abs(b.points - b.was) - Math.abs(a.points - a.was)).slice(0, 2);
    const why = top.length ? top.map(x => `${x.factor} ${x.was > 0 ? "+" : ""}${x.was} → ${x.points > 0 ? "+" : ""}${x.points}`).join(", ") : press.signals.slice(0, 2).map(x => x.txt).join(", ");
    await rest("rpc/set_flash", { method: "POST", body: { p_id: id, p_flash: {
      at: data.at, kind: "live", callAt: last?.at || null, nq: NQ.bias, es: ES.bias,
      headline: `Live read flipped NQ ${readBias} → ${NQ.bias} (${NQ.score > 0 ? "+" : ""}${NQ.score})`,
      why: `Live inputs moved since the ${last?.phase || "last"} read: ${why}. A full rescore is queued for the next check.` } } });
    const recent = await rest(`requests?kind=eq.run&created_at=gt.${encodeURIComponent(new Date(Date.now() - 45 * 60e3).toISOString())}&select=id`);
    if (!recent?.length) await rest("requests", { method: "POST", prefer: "return=minimal", body: { kind: "run" } });
    data.flagged = flip.since; out.flagged = true;
  }
  await rest("live?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { id, data, updated_at: data.at } });
  return out;
}
