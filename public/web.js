/* Verdict web shell: Supabase sign-in, Whop key gate, live briefs, account + comps.
   Loads after the main page script and reuses its state (S), render(), LOGO, IC and esc(). */
(() => {
  "use strict";
  const W = { cfg: null, sb: null, session: null, acc: null, screen: "loading", mode: "signin",
              msg: null, err: false, busy: false, acct: false, comps: null, compMsg: null, chan: null };
  const $ = id => document.getElementById(id);
  const baseRender = render;

  window.acctBtn = () => W.session && W.screen === "app"
    ? `<button class="round-btn" id="acct" aria-label="Account"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c1.2-3.6 4-5.4 7-5.4s5.8 1.8 7 5.4"/></svg></button>`
    : "";

  render = function () {
    if (W.screen !== "app") {
      $("app").innerHTML = gate();
      $("tabs").innerHTML = ""; $("tabs").style.display = "none";
      $("sheet-root").innerHTML = "";
      $("acct-root").innerHTML = "";
      const f = document.querySelector(".gate input");
      if (f && !W.focused) { W.focused = true; setTimeout(() => f.focus(), 30); }
      return;
    }
    $("tabs").style.display = "";
    baseRender();
    $("acct-root").innerHTML = W.acct ? acctSheet() : "";
  };

  /* ---------- views ---------- */
  const brand = `<div class="brand gate-brand">${LOGO}<div><b>Verdict</b><small>The macro call for NQ &amp; ES</small></div></div>`;
  const note = () => W.msg ? `<div class="notice ${W.err ? "err" : ""}">${esc(W.msg)}</div>` : "";
  const btn = (label, busyLabel) => `<button type="submit" class="run-btn gate-go" ${W.busy ? "disabled" : ""}>${W.busy ? busyLabel : label}</button>`;

  function gate() {
    if (W.screen === "loading") return `<div class="gate">${brand}<section class="panel"><span class="eyebrow">Loading</span><div class="ghost"><div></div><div></div></div></section></div>`;
    if (W.screen === "error") return `<div class="gate">${brand}<section class="panel"><span class="eyebrow">Can't start</span><p>${esc(W.msg || "Something went wrong.")}</p></section></div>`;
    if (W.screen === "reset") return `<div class="gate">${brand}<section class="panel"><span class="eyebrow">New password</span>
      <form id="reset-form" class="gate-form"><input name="password" type="password" autocomplete="new-password" minlength="8" placeholder="New password (8+ characters)" required>${btn("Save password", "Saving…")}</form>${note()}</section></div>`;
    if (W.screen === "locked" && !W.cfg?.licenses) {
      return `<div class="gate">${brand}<section class="panel"><span class="eyebrow">Private</span>
        <h2 class="gate-h">This one's private</h2>
        <p class="muted">Signed in as <b>${esc(W.acc?.email || W.session?.user?.email || "")}</b>, which doesn't have access.</p>${note()}
        <div class="gate-row"><button class="gate-link" id="signout" type="button">Sign out</button></div></section></div>`;
    }
    if (W.screen === "locked") {
      const buy = W.cfg?.buyUrl ? `<a class="gate-link" href="${esc(W.cfg.buyUrl)}" target="_blank" rel="noopener">Get a key on Whop →</a>` : "";
      return `<div class="gate">${brand}<section class="panel"><span class="eyebrow">Unlock Verdict</span>
        <h2 class="gate-h">Paste your Whop key</h2>
        <p class="muted">Signed in as <b>${esc(W.acc?.email || W.session?.user?.email || "")}</b>. Your key links to this account once.</p>
        <form id="license-form" class="gate-form"><input name="key" autocomplete="off" spellcheck="false" placeholder="License key" required>${btn("Unlock", "Checking…")}</form>
        ${note()}
        <div class="gate-row">${buy}<button class="gate-link" id="signout" type="button">Sign out</button></div></section></div>`;
    }
    const up = W.mode === "signup";
    return `<div class="gate">${brand}<section class="panel"><span class="eyebrow">${up ? "Create account" : "Sign in"}</span>
      <form id="auth-form" class="gate-form">
        <input name="email" type="email" autocomplete="email" placeholder="Email" required>
        <input name="password" type="password" autocomplete="${up ? "new-password" : "current-password"}" minlength="${up ? 8 : 1}" placeholder="Password${up ? " (8+ characters)" : ""}" required>
        ${btn(up ? "Create account" : "Sign in", up ? "Creating…" : "Signing in…")}
      </form>${note()}
      <div class="gate-row"><button class="gate-link" id="mode-toggle" type="button">${up ? "Have an account? Sign in" : "New here? Create an account"}</button>${up ? "" : `<button class="gate-link" id="forgot" type="button">Forgot password?</button>`}</div>
    </section><p class="foot">Macro read for planning, not trade signals.</p></div>`;
  }

  function acctSheet() {
    const a = W.acc || {};
    const src = a.source === "owner" ? "Owner" : a.source === "comp" ? "Comped" : a.source === "license" ? "Whop member" : "Member";
    const admin = a.role === "admin";
    const comps = admin ? `<div class="acct-block"><span class="eyebrow">Comped access</span>
        <form id="comp-form" class="gate-form inline"><input name="email" type="email" placeholder="friend@email.com" required><input name="note" placeholder="Note (optional)"><button type="submit" class="pill-btn">Add</button></form>
        ${W.compMsg ? `<div class="notice ${W.compMsg.err ? "err" : ""}">${esc(W.compMsg.text)}</div>` : ""}
        <div class="comp-list">${W.comps == null ? `<p class="muted">Loading…</p>` : W.comps.length ? W.comps.map(c => `<div class="comp"><span><b>${esc(c.email)}</b>${c.note ? `<small>${esc(c.note)}</small>` : ""}</span><button class="gate-link danger" data-comp-del="${esc(c.email)}" type="button">Remove</button></div>`).join("") : `<p class="muted">No comped accounts yet.</p>`}</div>
        <p class="faint" style="font-size:11.5px">They sign up with that email and get in without a key. Removing takes effect on their next visit.</p></div>
      ${W.cfg?.console ? `<div class="acct-block"><span class="eyebrow">Admin console</span><p class="muted" style="font-size:13px">Run now and Scan now here are free and go out with the next news check (every 10 min in the NY session, 30–60 min overnight). For an instant run, use the Claude page.</p><a class="gate-link" href="${esc(W.cfg.console)}" target="_blank" rel="noopener">Open the Claude page →</a></div>` : ""}` : "";
    return `<div class="scrim" id="acct-scrim"><div class="sheet" role="dialog" aria-modal="true" aria-label="Account">
      <div class="sheet-head"><h2 style="font-stretch:120%">Account</h2><button class="icon-btn" id="acct-close" aria-label="Close">${IC.close}</button></div>
      <div class="acct-block"><span class="eyebrow">Signed in</span><p><b>${esc(a.email || W.session?.user?.email || "")}</b></p><p class="muted" style="font-size:13px">${src}${admin ? " · Admin" : ""}</p></div>
      <div class="acct-block"><span class="eyebrow">Callsign</span>
        <form id="callsign-form" class="gate-form inline"><input name="callsign" maxlength="20" placeholder="e.g. ghost_nq" value="${esc(S.callsign || "")}" autocomplete="off" spellcheck="false"><button type="submit" class="pill-btn">Save</button></form>
        ${W.csMsg ? `<div class="notice ${W.csMsg.err ? "err" : ""}">${esc(W.csMsg.text)}</div>` : ""}
        <p class="faint" style="font-size:11.5px">Shown on the bias-vote leaderboard. 3–20 letters, numbers, _ - or .</p></div>
      <div class="acct-block" id="alerts"><span class="eyebrow">Phone alerts</span>${window.pushBlock ? pushBlock() : ""}</div>
      ${comps}
      <button class="pill-btn" id="signout" type="button">Sign out</button>
    </div></div>`;
  }

  /* ---------- data ---------- */
  async function api(path, body) {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + W.session.access_token }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Server error (${r.status})`);
    return j;
  }

  async function checkAccess() {
    if (W.recovery) return;
    W.screen = "loading"; render();
    try { W.acc = await api("/api/access"); }
    catch (e) { W.screen = "locked"; W.msg = e.message; W.err = true; render(); return; }
    if (W.recovery) return;
    if (!W.acc.access) { W.screen = "locked"; W.msg = W.acc.reason || null; W.err = Boolean(W.acc.reason); render(); return; }
    W.screen = "app"; W.msg = null;
    if (W.acc.role === "admin") enableAdmin();
    S.loaded = false; render();
    await loadBriefs();
    subscribe();
    pollQuote(); loadCal(); loadTape(); loadVote(); loadMe(); initPush(); loadLive(); loadWire();
  }

  async function loadBriefs() {
    const { data, error } = await W.sb.from("briefs").select("id,data").order("id", { ascending: false }).limit(90);
    if (error) { S.loaded = true; S.runMsg = "Couldn't load briefs: " + error.message; S.runErr = true; render(); return; }
    S.briefs = (data || []).map(r => ({ ...r.data, id: r.id }));
    S.loaded = true;
    if (!S.levels && !S.rp.playing) render();
  }

  function subscribe() {
    if (W.chan) return;
    W.chan = W.sb.channel("briefs-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "briefs" }, p => {
        const row = p.new; if (!row || !row.id || !row.data) return;
        const doc = { ...row.data, id: row.id };
        const i = S.briefs.findIndex(b => b.id === row.id);
        if (i >= 0) S.briefs[i] = doc; else { S.briefs.push(doc); S.briefs.sort((a, b) => b.id.localeCompare(a.id)); }
        if (!S.levels && !S.rp.playing && !W.acct) render();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "headlines" }, p => { if (window.hlIncoming) window.hlIncoming(p.new); if (!S.levels && !S.rp.playing && !W.acct && S.tab === "news") render(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "live" }, p => {
        const row = p.new; if (!row || !row.data) return;
        if (!S.liveBias || row.id >= S.liveBias.id) { S.liveBias = { ...row.data, id: row.id }; if (!S.levels && !S.rp.playing && !W.acct) render(); }
      })
      .subscribe();
  }

  /* ---------- admin: levels + the free Run/Scan queue ---------- */
  // Next scheduled news-watch check (ET): weekdays :13 from 00–15h, plus :03/:23/:33/:43/:53 from 9–15h; Sun–Thu evenings :13 19–23h and :43 18–23h.
  function nextWatch() {
    const d = new Date(); d.setSeconds(0, 0);
    for (let i = 1; i <= 4 * 24 * 60; i++) {
      const t = new Date(d.getTime() + i * 60e3), p = etParts(t), h = p.h, m = p.mi;
      const wk = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(p.wd), eve = ["Sun", "Mon", "Tue", "Wed", "Thu"].includes(p.wd);
      if (wk && m === 13 && h <= 15) return t;
      if (wk && [3, 23, 33, 43, 53].includes(m) && h >= 9 && h <= 15) return t;
      if (eve && m === 13 && h >= 19) return t;
      if (eve && m === 43 && h >= 18) return t;
    }
    return new Date(Date.now() + 3600e3);
  }
  const when = t => fmtTime(t.toISOString(), Date.now() - t.getTime() < -20 * 3600e3);
  async function queue(kind) {
    const { error } = await W.sb.from("requests").insert({ kind });
    if (error) { S.runMsg = "Couldn't queue that: " + error.message; S.runErr = true; render(); return null; }
    return nextWatch();
  }
  function enableAdmin() {
    S.canRun = true; S.canLevels = true;
    S.db = { doc: path => ({ set: async doc => {
      const id = path.split("/")[1];
      const { error } = await W.sb.from("inputs").upsert({ id, data: doc, updated_at: new Date().toISOString() });
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
    } }) };
    runNow = async function () {
      const t = await queue("run"); if (!t) return;
      S.awaitFrom = t.getTime() - 60e3; store.set("db-await", String(S.awaitFrom));
      S.runMsg = `Queued. The ${when(t)} check starts a fresh read, and it lands here a few minutes after.`; S.runErr = false; render();
    };
    scanNow = async function () {
      const t = await queue("scan"); if (!t) return;
      S.scanFrom = t.getTime() - 60e3; store.set("db-scan", String(S.scanFrom));
      S.runMsg = `Queued. The news scan runs at ${when(t)}.`; S.runErr = false; render();
    };
    W.sb.from("inputs").select("id,data").order("id", { ascending: false }).limit(30).then(({ data }) => {
      const m = {}; (data || []).forEach(r => { m[r.id] = r.data; }); S.inputs = m; if (!S.levels) render();
    });
  }

  /* ---------- live tape: NQ price every minute while the app is open ---------- */
  function futuresOpen() {
    const p = etParts(new Date()), h = p.h, d = p.wd;
    if (d === "Sat") return false;
    if (d === "Sun") return h >= 18;
    if (d === "Fri") return h < 17;
    return h !== 17;
  }
  async function pollQuote() {
    if (W.screen !== "app" || document.visibilityState !== "visible") return;
    if (!futuresOpen()) {
      // Market shut: show the last price, labeled Closed. Refresh it every 30 minutes at most.
      if (S.live?.closed && Date.now() - S.live.at < 30 * 60e3) return;
      try {
        const r = await fetch("/api/quote", { cache: "no-store" });
        const q = await r.json();
        if (!r.ok || !q.ok) throw new Error(q.error || "no quote");
        S.live = { q, at: Date.now(), closed: true };
      } catch { S.live = null; }
      if (!S.levels && !S.rp.playing && !W.acct) render();
      return;
    }
    try {
      const r = await fetch("/api/quote", { cache: "no-store" });
      const q = await r.json();
      if (!r.ok || !q.ok) throw new Error(q.error || "no quote");
      const prev = S.live && !S.live.closed ? S.live.q?.NQ?.price : null, px = q.NQ?.price;
      const dir = prev != null && px != null && px !== prev ? Math.sign(px - prev) : 0;
      S.live = { q, at: Date.now(), queued: S.live?.closed ? null : S.live?.queued || null, dir, dirAt: dir ? Date.now() : 0 };
    } catch (e) {
      S.live = { ...(S.live || {}), closed: false, err: "couldn't get a quote" };
    }
    const br = latest(), t = br && S.live.q && tapeRead(br, S.live.q);
    if (t && (t.state === "against" || t.state === "breakout")) trip(br);
    if (!S.levels && !S.rp.playing && !W.acct) render();
  }
  async function trip(br) {
    const key = br.id + "|" + (br.generatedAt || "");
    if (W.tripped === key) return;
    W.tripped = key;
    try {
      const r = await api("/api/trip", { date: br.id });
      S.live.queued = r.queued ? "rescore queued for the next check" : null;
      if (!r.queued && !r.flagged) W.tripped = null;
    } catch { W.tripped = null; }
    render();
  }
  setInterval(pollQuote, 60e3);

  /* ---------- economic calendar (week ahead) ---------- */
  async function loadCal(force) {
    if (!force && S.cal && Date.now() - S.cal.got < 20 * 60e3) return;
    try {
      const r = await fetch("/api/calendar");
      const c = await r.json();
      if (!r.ok || !c.ok) throw new Error(c.error || "no calendar");
      S.cal = { events: c.events, src: c.src, at: c.at, got: Date.now() };
    } catch { if (!S.cal) S.cal = { events: [], err: true, got: Date.now() }; }
    if (!S.levels && !S.rp.playing && !W.acct) render();
  }
  setInterval(() => { if (W.screen === "app" && document.visibilityState === "visible") loadCal(); }, 10 * 60e3);

  /* ---------- live bias engine (server, every 2 min) ---------- */
  async function loadLive() {
    if (W.screen !== "app") return;
    const { data, error } = await W.sb.from("live").select("id,data").order("id", { ascending: false }).limit(1);
    if (!error && data?.[0]) { S.liveBias = { ...data[0].data, id: data[0].id }; if (!S.levels && !S.rp.playing && !W.acct) render(); }
  }
  setInterval(() => { if (W.screen === "app" && document.visibilityState === "visible") loadLive(); }, 2 * 60e3);
  async function loadWire() {
    if (W.screen !== "app") return;
    const { data, error } = await W.sb.from("headlines").select("id,at,src,topic,who,weight,url,seen_at,px0,px30").order("at", { ascending: false }).limit(30);
    if (error || !data) return;
    const fresh = !S.wire;
    if (fresh) S.wire = data; else data.slice().reverse().forEach(h => { if (!S.wire.some(x => x.id === h.id) && window.hlIncoming) window.hlIncoming(h); });
    if (!S.levels && !S.rp.playing && !W.acct) render();
  }
  setInterval(() => { if (W.screen === "app" && document.visibilityState === "visible") loadWire(); }, 60e3);

  /* ---------- multi-asset tape + top NQ weights ---------- */
  async function loadTape(force) {
    if (W.screen !== "app" || document.visibilityState !== "visible") return;
    const open = futuresOpen();
    if (!force && S.tape && Date.now() - S.tape.got < (open ? 55e3 : 10 * 60e3)) return;
    try {
      const r = await fetch("/api/tape", { cache: "no-store" });
      const t = await r.json();
      if (!r.ok || !t.ok) throw new Error(t.error || "no tape");
      const prev = {}; (S.tape?.macro || []).concat(S.tape?.weights || []).forEach(x => { prev[x.k] = x.price; });
      const flash = {}; t.macro.concat(t.weights).forEach(x => { if (prev[x.k] != null && x.price !== prev[x.k]) flash[x.k] = x.price > prev[x.k] ? 1 : -1; });
      S.tape = { ...t, got: Date.now(), flash, flashAt: Date.now() };
    } catch { if (S.tape) S.tape.got = Date.now(); }
    if (!S.levels && !S.rp.playing && !W.acct) render();
  }
  setInterval(() => loadTape(), 15e3);

  /* ---------- pre-open vote + leaderboard ---------- */
  async function loadVote() {
    const br = latest(); if (!br || W.screen !== "app") return;
    const [t, b] = await Promise.all([W.sb.rpc("vote_tally", { p_day: br.id }), W.sb.rpc("vote_board")]);
    if (!t.error && t.data) S.vote = t.data;
    if (!b.error) S.board = b.data || [];
    if (!S.levels && !S.rp.playing && !W.acct) render();
  }
  async function castVote(side) {
    const br = latest(); if (!br) return;
    S.voteBusy = true; render();
    const { data, error } = await W.sb.rpc("cast_vote", { p_day: br.id, p_side: side });
    S.voteBusy = false;
    if (error) { S.voteMsg = error.message; } else { S.vote = data; S.voteMsg = null; }
    render();
  }
  setInterval(() => { if (W.screen === "app" && document.visibilityState === "visible") loadVote(); }, 2 * 60e3);
  async function loadMe() {
    const { data } = await W.sb.rpc("my_callsign");
    S.callsign = data || null;
  }

  /* ---------- phone push alerts ---------- */
  const b64u = s => { const p = "=".repeat((4 - s.length % 4) % 4); const r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(r, c => c.charCodeAt(0)); };
  async function initPush() {
    const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    S.push = { ok, ios, standalone, on: false, busy: false, msg: null };
    if (!ok) { render(); return; }
    try {
      W.swReg = await navigator.serviceWorker.register("/sw.js");
      const sub = await W.swReg.pushManager.getSubscription();
      S.push.on = Boolean(sub) && Notification.permission === "granted";
    } catch { S.push.ok = false; }
    render();
  }
  async function pushOn() {
    S.push.busy = true; S.push.msg = null; render();
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Notifications are blocked for this site. Allow them in your browser settings, then try again.");
      const { key } = await (await fetch("/api/push")).json();
      const reg = W.swReg || await navigator.serviceWorker.register("/sw.js");
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(key) });
      await api("/api/push", { sub: sub.toJSON() });
      S.push.on = true; S.push.msg = "Alerts are on for this device."; store.set("db-push-nudge", "1");
    } catch (e) { S.push.msg = e.message; S.push.err = true; }
    S.push.busy = false; render();
  }
  async function pushOff() {
    S.push.busy = true; render();
    try {
      const sub = await (W.swReg || await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) { await api("/api/push", { off: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
      S.push.on = false; S.push.msg = "Alerts are off for this device."; S.push.err = false;
    } catch (e) { S.push.msg = e.message; S.push.err = true; }
    S.push.busy = false; render();
  }
  async function pushTest() {
    S.push.busy = true; render();
    try { const r = await api("/api/push", { test: true }); S.push.msg = r.sent ? "Test sent. It should land in a few seconds." : "Couldn't reach this device. Turn alerts off and on again."; S.push.err = !r.sent; }
    catch (e) { S.push.msg = e.message; S.push.err = true; }
    S.push.busy = false; render();
  }
  window.pushBlock = () => {
    const P = S.push; if (!P) return "";
    if (P.ios && !P.standalone) return `<p class="muted" style="font-size:13px">On iPhone, alerts only work from the Home Screen app: tap Share → <b>Add to Home Screen</b>, open Verdict from there, then turn alerts on.</p>`;
    if (!P.ok) return `<p class="muted" style="font-size:13px">This browser can't do push alerts.</p>`;
    const msg = P.msg ? `<div class="notice ${P.err ? "err" : ""}">${esc(P.msg)}</div>` : "";
    return P.on
      ? `<p class="muted" style="font-size:13px">On for this device: bias flips, new calls, breaking news and high-impact USD releases 5 minutes out.</p>${msg}<div class="gate-row"><button class="pill-btn" id="push-test" type="button" ${P.busy ? "disabled" : ""}>Send a test</button><button class="gate-link danger" id="push-off" type="button" ${P.busy ? "disabled" : ""}>Turn off</button></div>`
      : `<p class="muted" style="font-size:13px">Get bias flips, new calls, breaking news and a heads-up 5 minutes before CPI, NFP, FOMC and the rest.</p>${msg}<button class="run-btn" id="push-on" type="button" ${P.busy ? "disabled" : ""}>${P.busy ? "Turning on…" : "Turn on alerts"}</button>`;
  };

  function teardown() {
    if (W.chan) { W.sb.removeChannel(W.chan); W.chan = null; }
    S.live = null; W.tripped = null; S.vote = null; S.board = null; S.callsign = null; S.liveBias = null;
    S.briefs = []; S.loaded = false; S.canRun = false; S.db = null; S.inputs = {}; W.acc = null; W.acct = false; W.comps = null;
  }

  async function loadComps() {
    const { data, error } = await W.sb.from("comps").select("email,note,added_at").order("added_at", { ascending: false });
    W.comps = error ? [] : data; if (error) W.compMsg = { err: true, text: error.message };
    render();
  }

  /* ---------- events ---------- */
  document.addEventListener("submit", async e => {
    const f = e.target;
    if (f.id === "callsign-form") {
      e.preventDefault();
      const { data, error } = await W.sb.rpc("set_callsign", { p_name: f.callsign.value });
      W.csMsg = error ? { err: true, text: error.message } : { err: false, text: `You're ${data} on the board.` };
      if (!error) { S.callsign = data; loadVote(); }
      render(); return;
    }
    if (f.id === "auth-form") {
      e.preventDefault();
      const email = f.email.value.trim(), password = f.password.value;
      W.busy = true; W.msg = null; render();
      const res = W.mode === "signup"
        ? await W.sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } })
        : await W.sb.auth.signInWithPassword({ email, password });
      W.busy = false;
      if (res.error) { W.msg = res.error.message; W.err = true; render(); return; }
      if (W.mode === "signup" && !res.data.session) { W.mode = "signin"; W.msg = "Check your email to confirm your account, then sign in."; W.err = false; render(); return; }
      W.session = res.data.session; await checkAccess();
    }
    if (f.id === "license-form") {
      e.preventDefault();
      W.busy = true; W.msg = null; render();
      try {
        const r = await api("/api/license", { key: f.key.value.trim() });
        W.busy = false;
        if (r.access) { W.acc = { ...(W.acc || {}), ...r }; await checkAccess(); }
        else { W.msg = r.reason || "That key didn't work."; W.err = true; render(); }
      } catch (err) { W.busy = false; W.msg = err.message; W.err = true; render(); }
    }
    if (f.id === "reset-form") {
      e.preventDefault();
      W.busy = true; render();
      const { error } = await W.sb.auth.updateUser({ password: f.password.value });
      W.busy = false;
      if (error) { W.msg = error.message; W.err = true; render(); return; }
      W.msg = null; W.recovery = false; await checkAccess();
    }
    if (f.id === "comp-form") {
      e.preventDefault();
      const email = f.email.value.trim().toLowerCase(), noteTxt = f.note.value.trim();
      const { error } = await W.sb.from("comps").upsert({ email, note: noteTxt || null });
      W.compMsg = error ? { err: true, text: error.message } : { err: false, text: `${email} can now sign up and get in free.` };
      await loadComps();
    }
  });

  document.addEventListener("click", async e => {
    const v = e.target.closest("[data-vote],#push-on,#push-off,#push-test,#open-acct,#push-nudge-off");
    if (v) {
      if (v.dataset.vote) { if (!S.voteBusy) castVote(v.dataset.vote); return; }
      if (v.id === "push-on") { pushOn(); return; }
      if (v.id === "push-off") { pushOff(); return; }
      if (v.id === "push-test") { pushTest(); return; }
      if (v.id === "push-nudge-off") { store.set("db-push-nudge", "1"); render(); return; }
      if (v.id === "open-acct") { W.acct = true; render(); return; }
    }
    const t = e.target.closest("#acct,#acct-close,#acct-scrim,#signout,#mode-toggle,#forgot,[data-comp-del]");
    if (!t) return;
    if (t.id === "acct-scrim" && e.target !== t) return;
    if (t.id === "acct") { W.acct = true; W.compMsg = null; render(); if (W.acc?.role === "admin") loadComps(); return; }
    if (t.id === "acct-close" || t.id === "acct-scrim") { W.acct = false; render(); return; }
    if (t.id === "signout") { await W.sb.auth.signOut(); teardown(); W.session = null; W.screen = "auth"; W.msg = null; render(); return; }
    if (t.id === "mode-toggle") { W.mode = W.mode === "signup" ? "signin" : "signup"; W.msg = null; W.focused = false; render(); return; }
    if (t.id === "forgot") {
      const email = document.querySelector('#auth-form input[name="email"]')?.value.trim();
      if (!email) { W.msg = "Type your email first, then tap Forgot password."; W.err = true; render(); return; }
      const { error } = await W.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
      W.msg = error ? error.message : "Check your email for a reset link."; W.err = Boolean(error); render(); return;
    }
    if (t.dataset.compDel) {
      const { error } = await W.sb.from("comps").delete().eq("email", t.dataset.compDel);
      W.compMsg = error ? { err: true, text: error.message } : { err: false, text: `Removed ${t.dataset.compDel}.` };
      await loadComps();
    }
  });

  document.addEventListener("keydown", e => { if (e.key === "Escape" && W.acct) { W.acct = false; render(); } });

  // Catch up after the phone wakes or the tab comes back.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && W.screen === "app") { loadBriefs(); pollQuote(); loadCal(); loadTape(true); loadVote(); loadLive(); loadWire(); } });

  /* ---------- boot ---------- */
  async function boot() {
    render();
    try { W.cfg = await (await fetch("/api/config", { cache: "no-store" })).json(); }
    catch { W.screen = "error"; W.msg = "Couldn't reach the server. Check your connection and reload."; render(); return; }
    if (!W.cfg.url || !W.cfg.anon) { W.screen = "error"; W.msg = "The app isn't configured yet: add the Supabase keys in Vercel."; render(); return; }
    if (!window.supabase?.createClient) { W.screen = "error"; W.msg = "Couldn't load the sign-in library. Reload the page."; render(); return; }
    W.sb = window.supabase.createClient(W.cfg.url, W.cfg.anon, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    W.sb.auth.onAuthStateChange((event, session) => {
      W.session = session;
      if (event === "PASSWORD_RECOVERY") { W.recovery = true; W.screen = "reset"; W.msg = null; render(); }
      if (event === "SIGNED_OUT" && W.screen === "app") { teardown(); W.screen = "auth"; render(); }
    });
    const { data } = await W.sb.auth.getSession();
    W.session = data.session;
    if (W.recovery) return;
    if (!W.session) { W.screen = "auth"; render(); return; }
    await checkAccess();
  }
  boot();
})();
