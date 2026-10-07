import { send } from "../lib/server.js";

// Public settings the page needs to start. The anon key is safe to expose; row-level security guards the data.
export default function handler(req, res) {
  send(res, 200, {
    url: process.env.SUPABASE_URL || null,
    anon: process.env.SUPABASE_ANON_KEY || null,
    buyUrl: process.env.WHOP_CHECKOUT_URL || null,
    console: process.env.ADMIN_CONSOLE_URL || null,
    licenses: Boolean(process.env.WHOP_API_KEY),
  });
}
