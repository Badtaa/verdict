import { getTape } from "../lib/tape.js";

// GET /api/tape → NQ, ES, 10Y, DXY, WTI, VIX, gold, BTC and the top NQ weights. Cached ~45s.
export default async function handler(req, res) {
  try {
    const t = await getTape();
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "public, max-age=0, s-maxage=40, stale-while-revalidate=40");
    res.end(JSON.stringify(t));
  } catch (err) {
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}
