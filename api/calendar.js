// GET /api/calendar → this week's economic calendar (Forex Factory's public weekly feed).
// The feed asks callers not to poll hard, so it's cached 30 min here and at Vercel's edge.
const FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
let cache = null;

async function load() {
  if (cache && Date.now() - cache.at < 30 * 60e3) return cache;
  try {
    const r = await fetch(FEED, { headers: { "user-agent": "Verdict/1.0 (+https://verdict-sooty-delta.vercel.app)", accept: "application/json" } });
    if (!r.ok) throw new Error(`feed returned ${r.status}`);
    const raw = await r.json();
    const events = (Array.isArray(raw) ? raw : []).map(e => ({
      t: Date.parse(e.date) || null,
      title: String(e.title || "").slice(0, 140),
      country: String(e.country || ""),
      impact: String(e.impact || "Low").toLowerCase(),
      forecast: e.forecast || "",
      previous: e.previous || "",
    })).filter(e => e.t && e.title).sort((a, b) => a.t - b.t);
    cache = { ok: true, at: Date.now(), src: "Forex Factory", events };
  } catch (err) {
    if (!cache) throw err; // serve the last good copy if the feed hiccups
  }
  return cache;
}

export default async function handler(req, res) {
  try {
    const c = await load();
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "public, max-age=300, s-maxage=1800, stale-while-revalidate=3600");
    res.end(JSON.stringify(c));
  } catch (err) {
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}
