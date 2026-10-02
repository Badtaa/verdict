#!/usr/bin/env python3
"""Build public/index.html from src/page.html (the same page that runs on Claude).

The Claude version boots from the artifact runtime (claude.use("db")). For the web, that boot block is
removed and public/web.js takes over: Supabase sign-in, the Whop key gate and live briefs.
Run: python3 scripts/build-web.py
"""
import pathlib, sys

root = pathlib.Path(__file__).resolve().parent.parent
src = (root / "src" / "page.html").read_text(encoding="utf-8")

BOOT = '\nrender();\n(async () => {\n  const db = await claude.use("db");'
start = src.find(BOOT)
end = src.rfind("</script>")
if start < 0 or end < start:
    sys.exit("build-web: couldn't find the artifact boot block in src/page.html")
body = src[:start] + "\n" + src[end:]

body = body.replace('<div id="sheet-root"></div>', '<div id="sheet-root"></div>\n<div id="acct-root"></div>', 1)

HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Verdict: the macro call for NQ and ES. Session-by-session bias, live news watch and a graded track record.">
<meta name="theme-color" content="#0A0918">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Verdict">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
"""

WEB_CSS = """<style>
/* ---------- web shell ---------- */
body{padding-top:env(safe-area-inset-top,0px)}
.gate{max-width:440px;margin:min(14vh,120px) auto 0;display:flex;flex-direction:column;gap:16px}
.gate-brand{display:flex;align-items:center;gap:12px}
.gate-brand svg{width:44px;height:44px}
.gate-brand b{display:block;font-family:var(--display);font-size:24px;letter-spacing:-.02em}
.gate-brand small{color:var(--muted);font-size:12.5px}
.gate-h{font-size:21px}
.gate-form{display:flex;flex-direction:column;gap:10px}
.gate-form.inline{flex-direction:row;flex-wrap:wrap}
.gate-form.inline input{flex:1 1 160px}
.gate-form input{height:46px;border-radius:14px;border:1px solid var(--line-hi);background:rgba(var(--panel-rgb),.55);color:var(--text);padding:0 14px;font:inherit;font-size:16px;min-width:0}
.gate-form input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(var(--accent-rgb),.18)}
.gate-go{width:100%;justify-content:center;height:46px}
.gate-row{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
.gate-link{background:none;border:0;padding:0;color:var(--accent-hi);font:600 13.5px/1.4 var(--font);text-decoration:none;cursor:pointer}
.gate-link.danger{color:var(--loss)}
.acct-block{display:flex;flex-direction:column;gap:8px;padding:14px 0;border-top:1px solid var(--line)}
.acct-block:first-of-type{border-top:0;padding-top:4px}
.comp-list{display:flex;flex-direction:column;gap:6px}
.comp{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--line);border-radius:12px}
.comp small{display:block;color:var(--muted);font-size:12px}
.pill-btn{display:inline-flex;align-items:center;justify-content:center;height:46px;padding:0 20px;border-radius:999px;border:1px solid var(--line-hi);background:rgba(var(--panel-rgb),.6);color:var(--text);font:700 14px/1 var(--font);cursor:pointer}
.pill-btn:hover{border-color:var(--accent)}
#acct-root .sheet>.pill-btn{width:100%;margin-top:6px}
#acct-root .sheet{max-width:520px}
</style>
"""


body = body.replace("</style>", "</style>\n" + WEB_CSS, 1)
# The Supabase library must load before the page's own script runs web.js, so put it ahead of the inline script.
first_script = body.find("<script>")
body = body[:first_script] + '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>\n' + body[first_script:]
body = body.rstrip() + '\n<script src="/web.js"></script>\n</html>\n'

out = HEAD + body
(root / "public" / "index.html").write_text(out, encoding="utf-8")
print(f"built public/index.html ({len(out):,} bytes)")
