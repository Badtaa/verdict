import { send, rest, configured } from "../lib/server.js";
import { pushAll, claim } from "../lib/push.js";
import { getCalendar } from "../lib/calendar.js";
import { runEngine } from "../lib/engine.js";

// POST /api/push-tick: called every minute by the database (pg_cron + pg_net) with a shared token.
// Sends, once each: a "bias shifting" flash, a new call (pre/post-data always; others when the NQ bias changed),
// a breaking-news alert, and a heads-up 5 minutes before each high-impact USD release.
const L = b => b === "bullish" ? "Bullish" : b === "bearish" ? "Bearish" : "Neutral";
const sg = n => (Number(n) > 0 ? "+" : "") + (Number(n) || 0);
const fresh = (iso, mins) => iso && Date.now() - Date.parse(iso) < mins * 60e3 && Date.parse(iso) <= Date.now() + 60e3;

export default async function handler(req, res) {
  if (!configured()) return send(res, 500, { error: "not configured" });
  try {
    const tok = await rest("app_secrets?k=eq.tick_token&select=v");
    if (!tok?.[0]?.v || req.headers["x-tick"] !== tok[0].v) return send(res, 401, { error: "bad token" });

    // Live bias engine every other minute (free; no Claude runs).
    let engine = null;
    if (new Date().getUTCMinutes() % 2 === 0 || req.query?.engine === "1") {
      try { engine = await runEngine({ force: req.query?.engine === "1" }); } catch (err) { engine = { error: err.message }; }
    }

    const out = [];
    const rows = await rest("briefs?select=id,data&order=id.desc&limit=1");
    const row = rows?.[0], br = row?.data || {};

    // 1) provisional flip
    const f = br.flash;
    if (f?.at && fresh(f.at, 30) && Date.parse(f.at) > Date.parse(br.generatedAt || 0) && await claim(`flash:${row.id}:${f.at}`))
      out.push({ kind: "flips", title: `⚡ Bias shifting: NQ now ${L(f.nq)}`, body: f.headline || "A full rescore is running.", tag: "flip" });

    // 2) new call
    const calls = br.calls || [], c = calls[calls.length - 1], p = calls[calls.length - 2];
    if (c?.at && fresh(c.at, 30)) {
      const changed = p && p.NQ?.bias !== c.NQ?.bias;
      if ((["pre", "post"].includes(c.phase) || changed) && await claim(`call:${row.id}:${c.at}`)) {
        const lead = String(br.headline || "").split(": ")[0].slice(0, 120);
        out.push({ kind: "calls", title: `${changed ? "🔄 Flipped" : "🎯 Verdict"}: NQ ${L(c.NQ?.bias)} ${sg(c.NQ?.score)} · ES ${L(c.ES?.bias)} ${sg(c.ES?.score)}`, body: lead || "New read is in.", tag: "call" });
      }
    }

    // 3) breaking alert from the news watch
    const a = (br.watch?.alerts || []).slice().sort((x, y) => String(y.at).localeCompare(String(x.at)))[0];
    if (a?.at && fresh(a.at, 20) && await claim(`alert:${row.id}:${a.at}`))
      out.push({ kind: "flips", title: "🚨 Breaking", body: a.headline || "Material news hit the tape.", tag: "alert" });

    // 4) high-impact USD release in ~5 minutes (grouped by release time)
    try {
      const cal = await getCalendar(), now = Date.now();
      const soon = cal.events.filter(e => e.country === "USD" && e.impact === "high" && e.t - now > 0 && e.t - now <= 6 * 60e3);
      const byT = {}; soon.forEach(e => { (byT[e.t] = byT[e.t] || []).push(e); });
      for (const [t, list] of Object.entries(byT)) {
        if (!await claim(`ev:${t}`)) continue;
        const mins = Math.max(1, Math.round((t - now) / 60e3));
        const fc = list.map(e => e.forecast ? `${e.title} F ${e.forecast}` : e.title).join(" · ");
        out.push({ kind: "events", title: `⏱ T-minus ${mins} min: ${list[0].title}${list.length > 1 ? ` +${list.length - 1}` : ""}`, body: fc, tag: `ev-${t}`, ttl: 600 });
      }
    } catch { /* calendar down: skip */ }

    // 5) pressure building (from the live engine), at most once per direction every 30 minutes
    try {
      const lr = await rest("live?select=id,data&order=id.desc&limit=1"); const L = lr?.[0]?.data;
      const P = L?.pressure;
      if (P?.strong && Date.now() - Date.parse(L.at) < 5 * 60e3) {
        const dir = P.score > 0 ? "up" : "down", pu = L.pushed;
        if (!pu || pu.dir !== dir || Date.now() - Date.parse(pu.at) > 30 * 60e3) {
          if (await claim(`press:${lr[0].id}:${dir}:${Math.floor(Date.now() / (30 * 60e3))}`)) {
            out.push({ kind: "flips", title: `${dir === "up" ? "📈" : "📉"} Pressure building ${dir === "up" ? "higher" : "lower"} for NQ`, body: P.signals.slice(0, 3).map(x => x.txt).join(" · "), tag: "pressure" });
            await rest(`rpc/set_live_pushed`, { method: "POST", body: { p_id: lr[0].id, p_pushed: { at: new Date().toISOString(), dir } } }).catch(() => {});
          }
        }
      }
    } catch { /* live table not ready */ }

    if (!out.length) return send(res, 200, { ok: true, sent: 0, engine });
    const [subs, active] = await Promise.all([
      rest("push_subs?select=endpoint,sub,user_id,prefs"),
      rest("members?active=eq.true&select=user_id"),
    ]);
    const ok = new Set((active || []).map(m => m.user_id));
    let sent = 0;
    for (const n of out) {
      const to = (subs || []).filter(s => ok.has(s.user_id) && s.prefs?.[n.kind] !== false);
      if (to.length) sent += (await pushAll(to, { title: n.title, body: n.body, tag: n.tag, url: "/", ttl: n.ttl }, `https://${req.headers.host}`)).sent;
    }
    send(res, 200, { ok: true, notes: out.map(n => n.title), sent, engine });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
}
