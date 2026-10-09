import { send, getUser, rest, configured, readBody } from "../lib/server.js";
import { getVapid, pushAll } from "../lib/push.js";

// GET  /api/push            → { key } VAPID public key for the browser to subscribe with
// POST /api/push {sub,prefs} → save this device for alerts
// POST /api/push {off: endpoint} → stop alerts on this device
// POST /api/push {test: true}  → send a test alert to this account's devices
export default async function handler(req, res) {
  if (!configured()) return send(res, 500, { error: "Server isn't configured yet." });
  try {
    if (req.method === "GET") return send(res, 200, { key: (await getVapid()).pub });
    if (req.method !== "POST") return send(res, 405, { error: "GET or POST" });
    const user = await getUser(req);
    if (!user) return send(res, 401, { error: "Sign in again." });
    const mem = await rest(`members?user_id=eq.${user.id}&select=active`);
    if (!mem?.[0]?.active) return send(res, 403, { error: "No access." });
    const b = await readBody(req);
    if (b.off) {
      await rest(`push_subs?endpoint=eq.${encodeURIComponent(b.off)}&user_id=eq.${user.id}`, { method: "DELETE", prefer: "return=minimal" });
      return send(res, 200, { ok: true, on: false });
    }
    if (b.test) {
      const subs = await rest(`push_subs?user_id=eq.${user.id}&select=endpoint,sub`);
      if (!subs?.length) return send(res, 400, { error: "This account has no devices with alerts on." });
      const r = await pushAll(subs, { title: "Verdict · comms check", body: "Alerts are live on this device. You'll get bias flips and high-impact releases 5 minutes out.", tag: "test", url: "/" }, `https://${req.headers.host}`);
      return send(res, 200, { ok: true, ...r });
    }
    const sub = b.sub;
    if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return send(res, 400, { error: "Bad subscription." });
    const P = b.prefs || {}, TOP = ["Fed & rates","US data","Tariffs & trade","Geopolitics","Oil & energy","China","Treasury & yields","Big tech & AI","Washington","Markets"];
    const prefs = { flips: P.flips !== false, events: P.events !== false, calls: P.calls !== false, turns: P.turns !== false,
      topics: Array.isArray(P.topics) ? P.topics.filter(t => TOP.includes(t)).slice(0, 10) : [],
      levels: Array.isArray(P.levels) ? P.levels.map(Number).filter(n => n > 0 && n < 1e6).slice(0, 8) : [],
      quiet: Array.isArray(P.quiet) && P.quiet.length === 2 && P.quiet.every(h => Number.isInteger(h) && h >= 0 && h < 24) ? P.quiet : null };
    await rest("push_subs?on_conflict=endpoint", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
      body: { endpoint: sub.endpoint, user_id: user.id, sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, prefs } });
    send(res, 200, { ok: true, on: true, prefs });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
}
