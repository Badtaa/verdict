import { send, getUser, rest, owners, whopCheck, upsertMember, configured } from "../lib/server.js";

// Works out whether the signed-in user can see briefs, and records it in `members` (which RLS reads).
// Order: owner email → comped email → linked Whop key (re-checked with Whop every 6 hours).
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  if (!configured()) return send(res, 500, { error: "Server isn't configured yet (Supabase keys missing)." });
  try {
    const user = await getUser(req);
    if (!user) return send(res, 401, { error: "Your session expired. Sign in again." });
    const email = (user.email || "").toLowerCase();
    const rows = await rest(`members?user_id=eq.${user.id}&select=*`);
    const m = rows?.[0] || null;

    let role = "member", source = null, active = false, reason = null;
    let checked_at = m?.checked_at || null;
    const license_key = m?.license_key ?? null;

    if (owners().includes(email)) {
      role = "admin"; source = "owner"; active = true;
    } else {
      const comp = await rest(`comps?email=eq.${encodeURIComponent(email)}&select=email`);
      if (comp?.length) {
        source = "comp"; active = true;
      } else if (license_key) {
        source = "license";
        const stale = !m.checked_at || Date.now() - Date.parse(m.checked_at) > 6 * 3600e3;
        if (stale) {
          const c = await whopCheck(license_key);
          if (c.transient) active = Boolean(m.active);
          else { active = c.ok; reason = c.ok ? null : c.reason; checked_at = new Date().toISOString(); }
        } else {
          active = Boolean(m.active);
        }
      }
    }

    await upsertMember({ user_id: user.id, email, role, source, active, checked_at, license_key });
    send(res, 200, { access: active, role, source, email, reason });
  } catch (err) {
    send(res, 500, { error: "Couldn't check access: " + err.message });
  }
}
