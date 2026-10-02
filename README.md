# Verdict

The macro call for NQ & ES: the session-by-session bias, a live news watch, scenario maps, dealer positioning and a graded track record.

## How it fits together

```
Claude scheduled tasks ──(Supabase connector: SQL)──▶ Supabase `briefs` ──(realtime)──▶ Vercel site (members)
        │                                                   ▲
        └──▶ Claude page (admin console: Run now, Scan now, levels)
```

- **Brain:** the Claude scheduled tasks do the work: evening, pre-data and post-data reads, the mid-session check, the news watcher and the grader. After each write they mirror the brief into Supabase.
- **Site:** `public/` is a static page that Vercel serves. Members sign in with Supabase email and password. Access comes from one of three sources:
  - the owner emails in `OWNER_EMAILS`
  - comped emails, which you add from the Account sheet
  - a Whop license key, re-checked with Whop every 6 hours
- **Private by default:** without a `WHOP_API_KEY`, only `OWNER_EMAILS` and comped emails get in.
- **Run now, Scan now and levels:** the site queues Run now and Scan now in Supabase, and the next news-watch check picks them up for free. Your levels save straight to Supabase.
- **Security:** the `members` table controls access through row-level security. Only the server functions in `api/` write to it.

## Files

| Path | What it is |
|---|---|
| `src/page.html` | The page itself, the same file that runs on Claude. |
| `scripts/build-web.py` | Builds `public/index.html` from `src/page.html`. |
| `public/web.js` | The web shell: sign-in, the key gate, live briefs and the account sheet. |
| `api/config.js` | Public config for the page (Supabase URL and anon key, Whop checkout link). |
| `api/access.js` | Decides whether the signed-in user gets in, and records it in `members`. |
| `api/license.js` | Links a Whop license key to an account. Each key works for one account. |
| `supabase/schema.sql` | Tables, row-level security, realtime, and the write helpers the tasks call. |

After changing `src/page.html`, run `python3 scripts/build-web.py` and commit `public/index.html`.

## Setup

1. **Supabase:** create a project, then run `supabase/schema.sql` in the SQL editor.
   - Under Authentication → URL Configuration, set the Site URL to your Vercel URL.
2. **Vercel:** import this repo. The framework is "Other"; there's no build step, and the output directory is `public`.
3. **Environment variables** in Vercel, for Production and Preview:

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | Project Settings → API → anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → service_role key (secret) |
| `OWNER_EMAILS` | Your email. Separate several with commas. |
| `WHOP_API_KEY` | A Whop API key with membership read access |
| `WHOP_PRODUCT_IDS` | Optional: comma-separated Whop product ids that unlock Verdict |
| `WHOP_CHECKOUT_URL` | Optional: the "Get a key" link shown on the lock screen |
| `ADMIN_CONSOLE_URL` | Optional: the Claude page link, shown to admins |

4. Redeploy. Then sign up with your owner email, and you're in as admin.

## Install on a phone

Open the site and use Add to Home Screen. It runs full screen with the Verdict icon.

Macro read for planning, not trade signals.
