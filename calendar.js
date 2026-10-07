import { getCalendar } from "../lib/calendar.js";

// GET /api/calendar → this week's economic calendar (Forex Factory). Cached 30 min here and at Vercel's edge.
export default async function handler(req, res) {
  try {
    const c = await getCalendar();
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
