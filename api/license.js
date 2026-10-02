import { send, getUser, rest, owners, whopCheck, upsertMember, readBody, configured } from "../lib/server.js";

// Links a Whop license key to the signed-in account. One key = one account.
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  if (!configured()) return send(res, 500, { error: "Server isn't configured yet (Supabase keys missing)." });
  try {
    const user = await getUser(req);
    if (!user) return send(res, 401, { error: "Your session expired. Sign in again." });
    const body = await readBody(req);
    const key = String(body.key || "").trim();
    if (key.length < 6 || key.length > 200) return send(res, 200, { access: false, reason: "Paste the full key from Whop." });

    const c = await whopCheck(key);
    if (!c.ok) return send(res, 200, { access: false, reason: c.reason });

    const used = await rest(`members?license_key=eq.${encodeURIComponent(key)}&user_id=neq.${user.id}&select=user_id`);
    if (used?.length) return send(res, 200, { access: false, reason: "That key is already linked to another account." });

    const email = (user.email || "").toLowerCase();
    const role = owners().includes(email) ? "admin" : "member";
    await upsertMember({
      user_id: user.id, email, role, source: "license", license_key: key,
      active: true, checked_at: new Date().toISOString(),
    });
    send(res, 200, { access: true, role, source: "license", email });
  } catch (err) {
    send(res, 500, { error: "Couldn't link the key: " + err.message });
  }
}
