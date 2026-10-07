// Shared helpers for the Vercel functions: plain fetch against Supabase and Whop.
const SB_URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const owners = () =>
  (process.env.OWNER_EMAILS || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);

export function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(obj));
}

export function configured() {
  return Boolean(SB_URL && ANON && SERVICE);
}

export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

// Resolve the signed-in user from the Supabase access token the page sends.
export async function getUser(req) {
  const h = req.headers.authorization || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!tok) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON, authorization: `Bearer ${tok}` } });
  if (!r.ok) return null;
  return r.json();
}

// PostgREST call with the service role (bypasses row-level security; server only).
export async function rest(path, { method = "GET", body, prefer } = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      "content-type": "application/json",
      ...(prefer ? { prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!r.ok) throw new Error(`database ${r.status}: ${text.slice(0, 200)}`);
  return json;
}

export async function upsertMember(row) {
  await rest("members?on_conflict=user_id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: row,
  });
}

// Whop membership check. GET /api/v1/memberships/{id} accepts a membership id or a license key.
const GOOD = new Set(["active", "trialing", "past_due", "completed", "canceling"]);
export async function whopCheck(key) {
  if (!process.env.WHOP_API_KEY) return { ok: false, reason: "Key checks aren't set up yet. Ask the admin." };
  let r;
  try {
    r = await fetch(`https://api.whop.com/api/v1/memberships/${encodeURIComponent(key)}`, {
      headers: { authorization: `Bearer ${process.env.WHOP_API_KEY}` },
    });
  } catch {
    return { ok: false, transient: true, reason: "Couldn't reach Whop. Try again in a minute." };
  }
  if (r.status === 404 || r.status === 400) return { ok: false, reason: "That key wasn't found." };
  if (!r.ok) return { ok: false, transient: true, reason: `Couldn't check the key right now (${r.status}).` };
  const m = await r.json();
  const products = (process.env.WHOP_PRODUCT_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
  const pid = m?.product?.id || m?.product_id || m?.access_pass?.id || null;
  if (products.length && !products.includes(pid)) return { ok: false, reason: "That key is for a different product." };
  if (!GOOD.has(m?.status)) return { ok: false, reason: `That membership is ${m?.status || "not active"}.` };
  return { ok: true, status: m.status };
}
