import { getQuotes } from "../lib/quote.js";

// GET /api/quote → live NQ / ES futures (cached ~25s on the server and 20s at Vercel's edge).
export default async function handler(req, res) {
  try {
    const q = await getQuotes();
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "public, max-age=0, s-maxage=20, stale-while-revalidate=20");
    res.end(JSON.stringify(q));
  } catch (err) {
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}
