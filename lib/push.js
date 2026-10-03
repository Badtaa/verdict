// Web push helpers. VAPID keys are generated once and kept in Supabase (app_secrets, server-only).
import webpush from "web-push";
import { rest } from "./server.js";

let vapid = null;
export async function getVapid() {
  if (vapid) return vapid;
  const rows = await rest("app_secrets?k=in.(vapid_public,vapid_private)&select=k,v");
  let pub = rows?.find(r => r.k === "vapid_public")?.v, priv = rows?.find(r => r.k === "vapid_private")?.v;
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    await rest("app_secrets?on_conflict=k", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal",
      body: [{ k: "vapid_public", v: k.publicKey }, { k: "vapid_private", v: k.privateKey }] });
    const again = await rest("app_secrets?k=in.(vapid_public,vapid_private)&select=k,v"); // another instance may have won the race
    pub = again.find(r => r.k === "vapid_public").v; priv = again.find(r => r.k === "vapid_private").v;
  }
  vapid = { pub, priv };
  return vapid;
}

// Sends one payload to many subscriptions; drops subscriptions the push service says are gone.
export async function pushAll(subs, payload, site) {
  const { pub, priv } = await getVapid();
  let sent = 0, dropped = 0;
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification(s.sub, JSON.stringify(payload), {
        TTL: payload.ttl || 900, urgency: "high",
        vapidDetails: { subject: site || "https://verdict-sooty-delta.vercel.app", publicKey: pub, privateKey: priv },
      });
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        dropped++;
        await rest(`push_subs?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
      }
    }
  }));
  return { sent, dropped };
}

// True the first time a key is claimed, false if it was already sent.
export async function claim(k) {
  const r = await rest("push_log?on_conflict=k", { method: "POST", prefer: "resolution=ignore-duplicates,return=representation", body: { k } });
  return Array.isArray(r) && r.length > 0;
}
