import { send, getUser, rest, configured } from "../lib/server.js";
import { getQuotes, tapeRead, futuresOpen } from "../lib/quote.js";

// POST /api/trip: the app saw price break against the call. The server re-checks with its own quote
// (never trusts the browser), then flags "bias shifting" on the brief and queues a rescore for the
// next news check. One flag per call, and at most one queued rescore every 20 minutes.
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  if (!configured()) return send(res, 500, { error: "Server isn't configured yet." });
  try {
    const user = await getUser(req);
    if (!user) return send(res, 401, { error: "Sign in again." });
    const mem = await rest(`members?user_id=eq.${user.id}&select=active`);
    if (!mem?.[0]?.active) return send(res, 403, { error: "No access." });
    if (!futuresOpen()) return send(res, 200, { queued: false, reason: "market closed" });

    const rows = await rest("briefs?select=id,data&order=id.desc&limit=1");
    const row = rows?.[0];
    if (!row) return send(res, 200, { queued: false, reason: "no brief" });
    const br = row.data;
    const t = tapeRead(br, await getQuotes());
    if (!t || (t.state !== "against" && t.state !== "breakout")) return send(res, 200, { queued: false, reason: "tape is fine", tape: t });

    let flagged = false;
    const f = br.flash;
    const fresh = f && f.callAt === t.callAt && Date.parse(f.at) > Date.parse(br.generatedAt || 0);
    if (!fresh) {
      const px = Number(t.price).toLocaleString("en-US", { maximumFractionDigits: 2 });
      await rest("rpc/set_flash", {
        method: "POST",
        body: {
          p_id: row.id,
          p_flash: {
            at: new Date().toISOString(), kind: "price", callAt: t.callAt, nq: t.lean, es: t.lean,
            headline: `NQ ${px}: ${t.why}`,
            why: t.state === "breakout"
              ? `Price broke out of the neutral range by more than ${t.T}%. A full rescore is queued for the next check.`
              : `Price broke against the ${t.bias} call by more than ${t.T}% (half the expected AM move). A full rescore is queued for the next check.`,
          },
        },
      });
      flagged = true;
    }

    const since = new Date(Date.now() - 20 * 60e3).toISOString();
    const recent = await rest(`requests?kind=eq.run&created_at=gt.${encodeURIComponent(since)}&select=id`);
    let queued = false;
    if (!recent?.length) {
      await rest("requests", { method: "POST", prefer: "return=minimal", body: { kind: "run" } });
      queued = true;
    }
    send(res, 200, { queued: queued || Boolean(recent?.length), flagged, tape: t });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
}
