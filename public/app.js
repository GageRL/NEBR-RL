(() => {
  "use strict";

  /* ---------- Constants ---------- */
  const PL = [
    { key: "duel", name: "1v1 Duel", short: "1s" },
    { key: "doubles", name: "2v2 Doubles", short: "2s" },
    { key: "standard", name: "3v3 Standard", short: "3s" }
  ];
  const TIER_BASES = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Champion", "Grand Champion"];
  const TIERS = ["Unranked"].concat(TIER_BASES.flatMap(t => [t + " I", t + " II", t + " III"]), ["Supersonic Legend"]);
  const DIVS = ["Div I", "Div II", "Div III", "Div IV"];
  const TIER_COLOR = { Unranked: "--t-unranked", Bronze: "--t-bronze", Silver: "--t-silver", Gold: "--t-gold", Platinum: "--t-platinum", Diamond: "--t-diamond", Champion: "--t-champion", "Grand Champion": "--t-gc", "Supersonic Legend": "--t-ssl" };
  const TYPES = {
    ranked: { label: "Ranked Session", individual: true },
    training: { label: "Training", individual: true }
  };
  const TYPE_KEYS = Object.keys(TYPES);
  const DEFAULT_MIN = { ranked: 90, training: 120 };
  const DEFAULT_FOCUS = ["Car control", "Shooting", "Aerials", "Dribbling & flicks", "Rotation", "Defense", "Boost management", "Kickoffs", "Recoveries", "Reads & decisions"];
  const DEFAULT_SETTINGS = {
    title: "Nebraska Esports",
    targets: { hours: 15, minDays: 0 },
    rankedGoals: { duel: { min: 5, max: 10 }, doubles: { min: 15, max: 20 }, standard: { min: null, max: null } }
  };
  const LONG_SESSION_MIN = 360;
  const REFL = [["well", "Went well"], ["cost", "Cost me games"], ["next", "Work on next"]];
  const TEAMS = [["varsity", "Varsity"], ["white", "White"], ["black", "Black"]];
  const teamName = t => { const x = TEAMS.find(p => p[0] === t); return x ? x[1] : ""; };

  /* ---------- Helpers ---------- */
  const $ = s => document.querySelector(s);
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const clone = o => JSON.parse(JSON.stringify(o));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const isPlain = v => v !== null && typeof v === "object" && !Array.isArray(v);
  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function todayStr() { return ymd(new Date()); }
  function parseYmd(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
  function mondayOf(s) { return addDays(s, -((parseYmd(s).getDay() + 6) % 7)); }
  function weekDates(wk) { return Array.from({ length: 7 }, (_, i) => addDays(wk, i)); }
  function fmtDate(s, o) { return parseYmd(s).toLocaleDateString("en-US", o); }
  function fmtDur(m) { m = Math.max(0, Math.round(m || 0)); const h = Math.floor(m / 60), r = m % 60; return h ? (r ? h + "h " + r + "m" : h + "h") : r + "m"; }
  function hrs(m) { const h = Math.round(((m || 0) / 60) * 10) / 10; return Number.isInteger(h) ? String(h) : h.toFixed(1); }
  function isTime(t) { return typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t); }
  function fmtTime(t) { if (!isTime(t)) return ""; const [h, mi] = t.split(":").map(Number); return (h % 12 || 12) + ":" + String(mi).padStart(2, "0") + " " + (h >= 12 ? "PM" : "AM"); }
  function fmtClock(iso) { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
  function fmtStamp(iso) { return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  function weekLabel(wk) { return fmtDate(wk, { month: "short", day: "numeric" }) + " – " + fmtDate(addDays(wk, 6), { month: "short", day: "numeric" }); }
  function n0(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; }
  function numOrNull(v) { if (v === null || v === undefined || v === "") return null; const n = Number(String(v).replace(/[,\s]/g, "")); return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null; }
  function numIn(v, def, max) { if (v === null || v === undefined || v === "") return def; const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : def; }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function str(v, max) { return typeof v === "string" ? v.slice(0, max || 4000) : ""; }
  function setVal(input, v) { if (document.activeElement !== input && input.value !== v) input.value = v; }
  function elapsedMin(iso) { return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); }
  function hms(iso) { const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000)); return Math.floor(s / 3600) + ":" + String(Math.floor((s % 3600) / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }
  function genPassword() { const a = "abcdefghjkmnpqrstuvwxyz23456789"; const r = crypto.getRandomValues(new Uint8Array(8)); return Array.from(r, x => a[x % a.length]).join(""); }
  const pref = {
    get(k) { try { return localStorage.getItem("ne:" + k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem("ne:" + k, v); } catch (_) {} }
  };
  function setStatus(el, msg, kind) { el.textContent = msg || ""; el.className = "status" + (kind ? " " + kind : ""); }

  /* ---------- API ---------- */
  class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  async function api(method, path, body) {
    let res;
    try {
      res = await fetch("/api/" + path, { method, credentials: "same-origin", headers: body !== undefined ? { "Content-Type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (_) { throw new ApiError(0, "Can't reach the site. Check your connection."); }
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      if (res.status === 401 && path !== "login") signedOut();
      throw new ApiError(res.status, (data && data.error) || "Something went wrong. Try again.");
    }
    return data || {};
  }

  /* ---------- Normalizers ---------- */
  function normSettings(raw) {
    const s = clone(DEFAULT_SETTINGS);
    if (!isPlain(raw)) return s;
    if (typeof raw.title === "string" && raw.title.trim()) s.title = raw.title.trim().slice(0, 60);
    const t = isPlain(raw.targets) ? raw.targets : {};
    s.targets.hours = numIn(t.hours, s.targets.hours, 80);
    s.targets.minDays = Math.round(numIn(t.minDays, s.targets.minDays, 7));
    if (isPlain(raw.rankedGoals)) for (const p of PL) {
      const g = isPlain(raw.rankedGoals[p.key]) ? raw.rankedGoals[p.key] : {};
      s.rankedGoals[p.key] = { min: numOrNull(g.min), max: numOrNull(g.max) };
    }
    return s;
  }
  function blankGames() { return { duel: { w: 0, l: 0 }, doubles: { w: 0, l: 0 }, standard: { w: 0, l: 0 } }; }
  function normActive(a) {
    if (!isPlain(a) || typeof a.id !== "string" || typeof a.week !== "string" || typeof a.startedAt !== "string" || !TYPES[a.type]) return null;
    return { id: a.id, week: a.week, type: a.type, startedAt: a.startedAt, date: /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : ymd(new Date(a.startedAt)) };
  }
  function normRanks(r) {
    const out = { playlists: {}, mmrChange: {}, pulledAt: null, ranksAt: null };
    const x = isPlain(r) ? r : {};
    out.pulledAt = typeof x.pulledAt === "string" ? x.pulledAt : null;
    out.ranksAt = typeof x.ranksAt === "string" ? x.ranksAt : null;
    for (const p of PL) {
      const q = isPlain(x.playlists) && isPlain(x.playlists[p.key]) ? x.playlists[p.key] : {};
      out.playlists[p.key] = { tier: TIERS.includes(q.tier) ? q.tier : null, div: DIVS.includes(q.div) ? q.div : null, mmr: numOrNull(q.mmr), games: numOrNull(q.games) };
      const ch = isPlain(x.mmrChange) ? x.mmrChange[p.key] : null;
      out.mmrChange[p.key] = typeof ch === "number" && Number.isFinite(ch) ? ch : null;
    }
    return out;
  }
  function normUser(u) {
    return { id: u.id, name: str(u.name, 32), role: u.role === "coach" ? "coach" : "player", team: TEAMS.some(t => t[0] === u.team) ? u.team : null, trackerUrl: str(u.trackerUrl, 300), ranks: normRanks(u.ranks), active: normActive(u.active), customFocus: Array.isArray(u.customFocus) ? u.customFocus.filter(f => typeof f === "string") : [], createdAt: Number(u.createdAt) || 0 };
  }
  function normSession(s) {
    const g = blankGames();
    if (isPlain(s.games)) for (const p of PL) { const x = isPlain(s.games[p.key]) ? s.games[p.key] : {}; g[p.key] = { w: n0(x.w), l: n0(x.l) }; }
    return {
      id: s.id, planId: typeof s.planId === "string" ? s.planId : null,
      date: /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : ymd(new Date(s.startedAt)),
      type: s.type, startedAt: s.startedAt, endedAt: typeof s.endedAt === "string" ? s.endedAt : null,
      minutes: Math.min(1440, n0(s.minutes)), edited: !!s.edited, warmup: !!s.warmup, games: g,
      focuses: Array.isArray(s.focuses) ? s.focuses.filter(f => typeof f === "string").slice(0, 20) : [],
      did: str(s.did), well: str(s.well), cost: str(s.cost), next: str(s.next)
    };
  }
  function normWeek(raw, id) {
    const w = { week: id, plan: {}, sessions: [] };
    if (!isPlain(raw)) return w;
    if (isPlain(raw.plan)) for (const d of Object.keys(raw.plan)) {
      const items = raw.plan[d];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Array.isArray(items)) continue;
      const arr = items.filter(i => isPlain(i) && TYPES[i.type] && typeof i.id === "string").map(i => ({ id: i.id, type: i.type, minutes: Math.min(720, n0(i.minutes)), time: isTime(i.time) ? i.time : "" }));
      if (arr.length) w.plan[d] = arr;
    }
    if (Array.isArray(raw.sessions)) w.sessions = raw.sessions.filter(s => isPlain(s) && typeof s.id === "string" && TYPES[s.type] && typeof s.startedAt === "string").map(normSession);
    return w;
  }

  /* ---------- State ---------- */
  const S = {
    today: todayStr(), phase: "loading", needsSetup: false,
    settings: normSettings(null), me: null, weeks: {},
    view: "player", wk: mondayOf(todayStr()), coachWk: mondayOf(todayStr()),
    roster: {}, rosterWeeks: {}, rosterLoaded: false, sel: null, pdFor: null,
    teamFilter: ["all", "varsity", "white", "black"].includes(pref.get("team")) ? pref.get("team") : "all",
    removals: {},
    undo: [], saveErr: null, settingsDirty: false
  };

  /* ---------- Saving ---------- */
  const timers = {}, inflight = new Set(), again = new Set(), dirty = new Set();
  function queue(key, delay) {
    dirty.add(key);
    clearTimeout(timers[key]);
    timers[key] = setTimeout(() => { delete timers[key]; flush(key); }, delay == null ? 600 : delay);
    renderConn();
  }
  async function runOp(key) {
    if (key === "me") return api("PATCH", "me", { active: S.me.active, customFocus: S.me.customFocus });
    if (key.startsWith("w:")) {
      const wk = key.slice(2);
      const rm = Array.from(S.removals[wk] || []);
      const r = await api("PUT", "weeks/" + wk, { data: S.weeks[wk] || normWeek(null, wk), remove: rm });
      if (S.removals[wk]) rm.forEach(id => S.removals[wk].delete(id));
      // Take the server's copy (finished sessions are locked there) unless newer local edits are waiting.
      if (r && r.data && !timers[key] && !again.has(key)) { S.weeks[wk] = normWeek(r.data, wk); renderToday(); renderWeek(); }
    }
  }
  async function flush(key) {
    if (!S.me) return;
    if (inflight.has(key)) { again.add(key); return; }
    inflight.add(key);
    renderConn();
    let ok = false;
    try { await runOp(key); ok = true; }
    catch (e) {
      if (e.status === 0 || e.status >= 500) {
        await sleep(1200 + Math.random() * 1000);
        try { await runOp(key); ok = true; } catch (e2) { S.saveErr = e2.message; }
      } else S.saveErr = e.message;
    } finally {
      inflight.delete(key);
      if (ok) S.saveErr = null;
      if (again.has(key)) { again.delete(key); flush(key); return; }
      if (ok && !timers[key]) dirty.delete(key);
      renderConn();
    }
  }
  function flushAll() { for (const k of Object.keys(timers)) { clearTimeout(timers[k]); delete timers[k]; flush(k); } }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushAll(); else if (S.me) refresh(); });
  window.addEventListener("pagehide", flushAll);
  window.addEventListener("beforeunload", e => { if (Object.keys(timers).length || inflight.size) { flushAll(); e.preventDefault(); e.returnValue = ""; } });

  function patchMe(patch, delay) { if (!S.me) return; Object.assign(S.me, clone(patch)); queue("me", delay); }
  function getWeek(wk) { return S.weeks[wk] || normWeek(null, wk); }
  function mutateWeek(wk, fn, delay) { const w = clone(getWeek(wk)); fn(w); S.weeks[wk] = w; queue("w:" + wk, delay); }
  function findSession(wk, id) { const w = S.weeks[wk]; return w ? w.sessions.find(s => s.id === id) || null : null; }

  function renderConn() {
    const el = $("#connState");
    if (S.phase !== "app") { el.textContent = ""; return; }
    let s, t;
    if (inflight.size || Object.keys(timers).length) { s = "saving"; t = "Saving…"; }
    else if (S.saveErr) { s = "error"; t = S.saveErr; }
    else { s = "saved"; t = "Saved"; }
    el.dataset.state = s;
    el.textContent = t;
  }

  /* ---------- Week math ---------- */
  function sumMin(list, pred) { return list.reduce((a, x) => a + (pred(x) ? x.minutes : 0), 0); }
  function weekStats(w, wk) {
    const today = S.today;
    const st = { pInd: 0, dInd: 0, rInd: 0, pDays: 0, dDays: 0, rDays: 0, games: blankGames(), hasAny: false };
    for (const d of weekDates(wk)) {
      const items = (w && w.plan[d]) || [];
      const ses = w ? w.sessions.filter(s => s.date === d && s.endedAt) : [];
      if (items.length || (w && w.sessions.some(s => s.date === d))) st.hasAny = true;
      const pI = sumMin(items, () => true), dI = sumMin(ses, () => true);
      const pD = items.length > 0, dD = ses.length > 0;
      st.pInd += pI; st.dInd += dI;
      if (pD) st.pDays++; if (dD) st.dDays++;
      if (d > today) { st.rInd += pI; if (pD) st.rDays++; }
      else if (d === today) { st.rInd += Math.max(0, pI - dI); if (pD && !dD) st.rDays++; }
      for (const s of ses) for (const p of PL) { st.games[p.key].w += s.games[p.key].w; st.games[p.key].l += s.games[p.key].l; }
    }
    return st;
  }
  function reqRows(st) {
    const T = S.settings.targets, rows = [];
    if (T.hours > 0) rows.push({ key: "ind", label: "Hours", target: Math.round(T.hours * 60), planned: st.pInd, done: st.dInd, remain: st.rInd, fmt: hrs, unit: " h" });
    if (T.minDays > 0) rows.push({ key: "days", label: "Training days", target: T.minDays, planned: st.pDays, done: st.dDays, remain: st.rDays, fmt: String, unit: "" });
    return rows;
  }
  function shortfall(rows) {
    const out = [];
    for (const r of rows) {
      const gap = r.target - r.planned;
      if (gap <= 0) continue;
      out.push(r.key === "ind" ? hrs(gap) + " h" : gap + (gap === 1 ? " day" : " days"));
    }
    return out;
  }
  function renderReqs(box, rows) {
    box.textContent = "";
    for (const r of rows) {
      const wrap = mk("div", "req");
      const top = mk("div", "req-top");
      const name = mk("span", "req-name", r.label);
      if (r.note) name.append(mk("span", "fine", " · " + r.note));
      const nums = mk("span", "req-nums");
      nums.append(mk("b", "", r.fmt(r.done)), document.createTextNode(" / " + r.fmt(r.target) + r.unit + " · " + r.fmt(r.planned) + " planned"));
      top.append(name, nums);
      const meter = mk("div", "meter" + (r.done >= r.target ? " full" : ""));
      meter.setAttribute("role", "img");
      meter.setAttribute("aria-label", r.label + ": " + r.fmt(r.done) + " done, " + r.fmt(r.planned) + " planned of " + r.fmt(r.target) + r.unit);
      const plan = mk("span", "m-plan"); plan.style.width = Math.min(100, (r.planned / r.target) * 100) + "%";
      const done = mk("span", "m-done"); done.style.width = "calc(" + Math.min(100, (r.done / r.target) * 100) + "% - 4px)";
      done.hidden = r.done <= 0;
      meter.append(plan, done);
      wrap.append(top, meter);
      box.append(wrap);
    }
  }
  function verdictText(rows) {
    const short = shortfall(rows);
    if (!rows.length) return ["", ""];
    return short.length ? ["Short: " + short.join(", "), "verdict short"] : ["✓ Plan covers the week", "verdict good"];
  }

  /* ---------- Window chrome ---------- */
  function setMin(win, min) {
    win.classList.toggle("min", min);
    const b = win.querySelector(".tmin");
    if (b && b.id !== "accClose") { b.setAttribute("aria-expanded", String(!min)); b.textContent = min ? "□" : "_"; }
  }
  document.querySelectorAll(".win .tmin").forEach(b => {
    if (b.id === "accClose") return;
    const win = b.closest(".win");
    if (pref.get("min:" + win.id) === "1") setMin(win, true);
    b.addEventListener("click", () => { const m = !win.classList.contains("min"); setMin(win, m); pref.set("min:" + win.id, m ? "1" : "0"); });
  });
  function showWin(sel) { const w = $(sel); setMin(w, false); pref.set("min:" + w.id, "0"); w.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" }); }

  /* ---------- Header + taskbar ---------- */
  function renderHeader() { $("#teamTitle").textContent = S.settings.title; document.title = S.settings.title; }
  function setView(v) { S.view = v; pref.set("view", v); if (v === "coach") loadCoach(); renderAll(); window.scrollTo({ top: 0 }); }
  function renderTaskbar() {
    const box = $("#taskBtns");
    box.textContent = "";
    if (S.phase !== "app") return;
    const add = (label, cls, pressed, fn) => { const b = mk("button", "task " + cls, label); b.type = "button"; if (pressed !== null) b.setAttribute("aria-pressed", String(pressed)); b.addEventListener("click", fn); box.append(b); };
    if (S.me.role === "coach") {
      add("Coach", "view", S.view === "coach", () => setView("coach"));
      add("My Training", "view", S.view === "player", () => setView("player"));
      box.append(mk("span", "tsep"));
    }
    const secs = S.view === "coach" ? [["Roster", "#winRoster"], ["Player", "#winPlayer"], ["Team", "#winTeam"]] : [["Today", "#winToday"], ["My Week", "#winWeek"], ["Ranks", "#winRanks"]];
    for (const [label, sel] of secs) add(label, "sec", null, () => showWin(sel));
    add(S.me.name || "Account", "acct", null, openAccount);
  }
  function tickClock() { $("#clock").textContent = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }

  /* ---------- Auth ---------- */
  function renderAuth() {
    const setup = S.needsSetup;
    $("#tAuth").textContent = setup ? "Create Coach Account" : "Sign On";
    $("#authPw2Row").hidden = !setup;
    $("#authPw").autocomplete = setup ? "new-password" : "current-password";
    $("#authGo").textContent = setup ? "Create" : "Sign On";
  }
  $("#authForm").addEventListener("submit", async e => {
    e.preventDefault();
    const st = $("#authStatus"), go = $("#authGo");
    const name = $("#authName").value.trim(), pw = $("#authPw").value;
    if (!name || !pw) { setStatus(st, "Enter your name and password.", "err"); return; }
    if (S.needsSetup) {
      if (pw.length < 8) { setStatus(st, "Use at least 8 characters.", "err"); return; }
      if (pw !== $("#authPw2").value) { setStatus(st, "Passwords don't match.", "err"); return; }
    }
    go.disabled = true;
    setStatus(st, "");
    try {
      await api("POST", S.needsSetup ? "setup" : "login", { name, password: pw });
      $("#authPw").value = ""; $("#authPw2").value = "";
      await boot();
    } catch (err) { setStatus(st, err.message, "err"); }
    finally { go.disabled = false; }
  });
  function signedOut() {
    if (S.phase === "auth") return;
    for (const k of Object.keys(timers)) { clearTimeout(timers[k]); delete timers[k]; }
    dirty.clear();
    S.phase = "auth"; S.me = null; S.weeks = {}; S.roster = {}; S.rosterWeeks = {}; S.sel = null; S.pdFor = null; S.needsSetup = false;
    setStatus($("#authStatus"), "Signed out. Sign on again.", "err");
    renderAll();
  }
  function openAccount() {
    const w = $("#winAccount");
    w.hidden = false;
    $("#accName").textContent = S.me.name + (S.me.team ? " · " + teamName(S.me.team) : "");
    setStatus($("#pwStatus"), "");
    w.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
  }
  $("#accClose").addEventListener("click", () => { $("#winAccount").hidden = true; });
  $("#pwForm").addEventListener("submit", async e => {
    e.preventDefault();
    const st = $("#pwStatus");
    try {
      await api("POST", "password", { current: $("#pwCur").value, next: $("#pwNew").value });
      $("#pwCur").value = ""; $("#pwNew").value = "";
      setStatus(st, "Password changed.", "ok");
    } catch (err) { setStatus(st, err.message, "err"); }
  });
  $("#signOff").addEventListener("click", async () => {
    flushAll();
    try { await api("POST", "logout", {}); } catch (_) {}
    S.phase = "auth"; S.me = null; S.weeks = {}; S.roster = {}; S.rosterWeeks = {}; S.sel = null; S.pdFor = null;
    $("#winAccount").hidden = true;
    setStatus($("#authStatus"), "");
    await boot();
  });

  /* ---------- Today ---------- */
  function keyed(container, keys, make, update) {
    const existing = new Map(Array.from(container.children).map(c => [c.dataset.key, c]));
    keys.forEach((k, i) => {
      let node = existing.get(k);
      if (!node) { node = make(k); node.dataset.key = k; }
      existing.delete(k);
      update(node, k);
      if (container.children[i] !== node) container.insertBefore(node, container.children[i] || null);
    });
    existing.forEach(n => n.remove());
  }
  function activeSession() { const a = S.me && S.me.active; return a ? findSession(a.week, a.id) : null; }
  function buildCounters(box) {
    for (const p of PL) {
      const c = mk("div", "ctr");
      c.dataset.pl = p.key;
      c.innerHTML = '<div class="ctr-head"><span class="ctr-name">' + p.name + '</span><span class="ctr-goal"></span></div>' +
        '<div class="segs" aria-hidden="true"></div>' +
        '<div class="ctr-main"><span class="ctr-count">0</span><span class="ctr-wl"><span class="w">0W</span> <span class="l">0L</span></span>' +
        '<div class="ctr-btns"><button type="button" class="btn loss-btn" data-act="game" data-pl="' + p.key + '" data-res="l" aria-label="' + p.short + ' loss">Loss</button>' +
        '<button type="button" class="btn win-btn" data-act="game" data-pl="' + p.key + '" data-res="w" aria-label="' + p.short + ' win">Win</button></div></div>';
      box.append(c);
    }
  }
  function updateCounters(box, s) {
    for (const p of PL) {
      const c = box.querySelector('.ctr[data-pl="' + p.key + '"]');
      const g = s ? s.games[p.key] : { w: 0, l: 0 };
      const n = g.w + g.l;
      c.querySelector(".ctr-count").textContent = n;
      c.querySelector(".w").textContent = g.w + "W";
      c.querySelector(".l").textContent = g.l + "L";
      const goal = S.settings.rankedGoals[p.key];
      const gEl = c.querySelector(".ctr-goal"), segs = c.querySelector(".segs");
      if (goal && goal.max) {
        const hit = n >= goal.min;
        gEl.textContent = (hit ? "✓ " : "") + (goal.min === goal.max ? goal.min : goal.min + "–" + goal.max);
        gEl.classList.toggle("hit", hit);
        segs.hidden = false;
        segs.classList.toggle("hit", hit);
        if (segs.children.length !== goal.max) { segs.textContent = ""; for (let i = 0; i < goal.max; i++) segs.append(mk("i", i >= goal.min ? "stretch" : "")); }
        Array.from(segs.children).forEach((x, i) => x.classList.toggle("on", i < n));
      } else { gEl.textContent = ""; gEl.classList.remove("hit"); segs.hidden = true; }
    }
  }
  function allFocuses() {
    const seen = new Map();
    const add = f => { const k = String(f).trim().toLowerCase(); if (k && !seen.has(k)) seen.set(k, String(f).trim()); };
    DEFAULT_FOCUS.forEach(add);
    if (S.me) S.me.customFocus.forEach(add);
    return Array.from(seen.values());
  }
  function renderChips(box, selected) {
    const want = allFocuses();
    if (box.children.length !== want.length || Array.from(box.children).some((c, i) => c.dataset.f !== want[i])) {
      box.textContent = "";
      for (const f of want) { const b = mk("button", "chip", f); b.type = "button"; b.dataset.act = "focus"; b.dataset.f = f; box.append(b); }
    }
    Array.from(box.children).forEach(b => b.setAttribute("aria-pressed", String(selected.includes(b.dataset.f))));
  }
  function makeActiveCard() {
    const c = mk("div", "card live");
    c.innerHTML =
      '<div class="card-head"><p class="ctype"></p><p class="ctime mono"></p></div>' +
      '<div class="warnbox long-warn" hidden><p>Still checked in after 6 hours?</p>' +
      '<div class="row"><input type="number" class="lw-min" min="1" max="1440" step="5" placeholder="Minutes" aria-label="Actual minutes"><button type="button" class="btn" data-act="checkout-set">Check out with this time</button></div></div>' +
      '<label class="chk sec-warm"><input type="checkbox" data-sfield="warmup"> Warmup</label>' +
      '<div class="ctrs sec-ranked"></div>' +
      '<div class="row sec-ranked"><button type="button" class="btn sm" data-act="undo">Undo</button></div>' +
      '<div class="fld sec-focus"><span class="lbl">Focus</span><div class="chips"></div>' +
      '<form class="addf" data-form="addfocus"><input type="text" maxlength="30" placeholder="Add" aria-label="Add a focus area"><button type="submit" class="btn sm">+</button></form></div>' +
      '<label class="fld"><span class="lbl lbl-did">Notes</span><textarea rows="2" data-sfield="did"></textarea></label>' +
      '<div class="refl">' + REFL.map(([k, l]) => '<label class="fld"><span class="lbl">' + l + '</span><textarea rows="2" data-sfield="' + k + '"></textarea></label>').join("") + '</div>' +
      '<p class="fine">Sessions lock at check out.</p>' +
      '<div class="card-actions"><button type="button" class="btn primary" data-act="checkout">Check out</button></div>';
    buildCounters(c.querySelector(".ctrs"));
    return c;
  }
  function updateActiveCard(c) {
    const a = S.me.active, s = activeSession();
    c.dataset.week = a.week;
    c.dataset.sid = a.id;
    c.querySelector(".ctype").textContent = TYPES[a.type].label;
    c.querySelector(".ctime").textContent = hms(a.startedAt);
    c.querySelector(".ctime").title = "Checked in at " + fmtClock(a.startedAt) + (a.date !== S.today ? ", " + fmtDate(a.date, { weekday: "short", month: "short", day: "numeric" }) : "");
    c.querySelector(".long-warn").hidden = elapsedMin(a.startedAt) < LONG_SESSION_MIN;
    const isRanked = a.type === "ranked", isTrain = a.type === "training";
    c.querySelector(".sec-warm").hidden = !(isRanked || isTrain);
    c.querySelectorAll(".sec-ranked").forEach(x => { x.hidden = !isRanked; });
    c.querySelector(".sec-focus").hidden = !isTrain;
    if (s) {
      c.querySelector('[data-sfield="warmup"]').checked = s.warmup;
      if (isRanked) updateCounters(c.querySelector(".ctrs"), s);
      if (isTrain) renderChips(c.querySelector(".chips"), s.focuses);
      setVal(c.querySelector('[data-sfield="did"]'), s.did);
      for (const [k] of REFL) setVal(c.querySelector('[data-sfield="' + k + '"]'), s[k]);
    }
    c.querySelector('[data-act="undo"]').disabled = !S.undo.some(u => u.sid === a.id);
  }
  function makePlannedCard() {
    const c = mk("div", "card");
    c.innerHTML = '<div class="card-head"><p class="ctype"></p><p class="cmeta"></p></div><div class="card-actions"><button type="button" class="btn primary" data-act="checkin">Check in</button></div>';
    return c;
  }
  function updatePlannedCard(c, item) {
    c.querySelector(".ctype").textContent = TYPES[item.type].label;
    c.querySelector(".cmeta").textContent = fmtDur(item.minutes) + (item.time ? " · " + fmtTime(item.time) : "");
    const b = c.querySelector('[data-act="checkin"]');
    b.dataset.plan = item.id;
    b.dataset.type = item.type;
    b.disabled = !!S.me.active;
  }
  function makeDoneCard() {
    const c = mk("div", "card");
    c.innerHTML =
      '<div class="card-head"><p class="ctype"></p><p class="cmeta"></p></div>' +
      '<p class="csum"></p>' +
      '<div class="ro"></div>' +
      '<div class="card-actions"><button type="button" class="btn sm danger" data-act="rmsess">Remove</button></div>';
    return c;
  }
  function fillReadOnly(box, s) {
    box.textContent = "";
    const add = (label, text) => { if (!text || !text.trim()) return; const p = mk("p", "pd-refl"); p.append(mk("b", "", label + ": "), document.createTextNode(text.trim())); box.append(p); };
    add("Notes", s.did);
    for (const [k, l] of REFL) add(l, s[k]);
    box.hidden = !box.children.length;
  }
  function sessionSummary(s) {
    const bits = [];
    if (s.type === "ranked") {
      const g = PL.filter(p => s.games[p.key].w + s.games[p.key].l > 0).map(p => p.short + " " + (s.games[p.key].w + s.games[p.key].l) + " (" + s.games[p.key].w + "–" + s.games[p.key].l + ")");
      if (g.length) bits.push(g.join(" · "));
    }
    if (s.warmup) bits.push("Warmup");
    if (s.focuses.length) bits.push(s.focuses.join(", "));
    return bits.join(" · ");
  }
  function updateDoneCard(c, s, wk) {
    c.dataset.week = wk;
    c.dataset.sid = s.id;
    c.querySelector(".ctype").textContent = TYPES[s.type].label;
    c.querySelector(".cmeta").textContent = fmtClock(s.startedAt) + "–" + fmtClock(s.endedAt) + " · " + fmtDur(s.minutes) + (s.edited ? " · edited" : "");
    const sum = sessionSummary(s), sumEl = c.querySelector(".csum");
    sumEl.textContent = sum;
    sumEl.hidden = !sum;
    fillReadOnly(c.querySelector(".ro"), s);
  }
  function renderToday() {
    if (!S.me) return;
    const t = S.today, wk = mondayOf(t), w = S.weeks[wk];
    $("#todayDate").textContent = fmtDate(t, { weekday: "long", month: "long", day: "numeric" });
    const items = (w && w.plan[t]) || [];
    const sessions = w ? w.sessions.filter(s => s.date === t) : [];
    const used = new Set(sessions.map(s => s.planId).filter(Boolean));
    const pending = items.filter(i => !used.has(i.id));
    const done = sessions.filter(s => s.endedAt).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const parts = [];
    if (items.length) parts.push(items.length + " planned");
    if (done.length) parts.push(done.length + " done");
    $("#todayKind").textContent = parts.join(" · ");
    const a = S.me.active;
    keyed($("#activeBox"), a ? [a.id] : [], makeActiveCard, c => updateActiveCard(c));
    keyed($("#plannedBox"), pending.map(i => i.id), makePlannedCard, (c, id) => updatePlannedCard(c, pending.find(i => i.id === id)));
    keyed($("#doneBox"), done.map(s => s.id), makeDoneCard, (c, id) => updateDoneCard(c, done.find(s => s.id === id), wk));
    $("#adhocForm").hidden = !!a;
  }
  (function fillAdhoc() { const sel = $("#adhocType"); TYPE_KEYS.forEach(k => sel.append(new Option(TYPES[k].label, k))); })();

  function checkIn(type, planId) {
    if (!S.me || S.me.active || !TYPES[type]) return;
    const now = new Date(), date = S.today, wk = mondayOf(date);
    const s = normSession({ id: newId(), planId: planId || null, date, type, startedAt: now.toISOString() });
    mutateWeek(wk, w => { w.sessions.push(s); }, 0);
    patchMe({ active: { id: s.id, week: wk, type, startedAt: s.startedAt, date } }, 0);
    S.undo = [];
    renderToday(); renderWeek();
  }
  function checkOut(overrideMin) {
    const a = S.me && S.me.active;
    if (!a) return;
    const end = new Date();
    mutateWeek(a.week, w => {
      const s = w.sessions.find(x => x.id === a.id);
      if (!s) return;
      s.endedAt = end.toISOString();
      if (overrideMin) { s.minutes = Math.min(1440, overrideMin); s.edited = true; }
      else s.minutes = Math.max(1, Math.round((end.getTime() - new Date(s.startedAt).getTime()) / 60000));
    }, 0);
    patchMe({ active: null }, 0);
    S.undo = [];
    renderToday(); renderWeek();
  }
  function cardCtx(node) { const c = node.closest(".card"); return c && c.dataset.sid ? { c, wk: c.dataset.week, sid: c.dataset.sid } : null; }
  function mutateSession(wk, sid, fn, delay) { mutateWeek(wk, w => { const s = w.sessions.find(x => x.id === sid); if (s) fn(s); }, delay); }

  const todayBody = $("#winToday .wbody");
  todayBody.addEventListener("click", e => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === "checkin") { checkIn(b.dataset.type, b.dataset.plan); return; }
    if (act === "checkout") { checkOut(null); return; }
    if (act === "checkout-set") { const v = n0(b.closest(".warnbox").querySelector(".lw-min").value); if (v > 0) checkOut(v); return; }
    const ctx = cardCtx(b);
    if (!ctx) return;
    if (act === "game") {
      const pl = b.dataset.pl, res = b.dataset.res;
      mutateSession(ctx.wk, ctx.sid, s => { s.games[pl][res] += 1; }, 300);
      S.undo.push({ sid: ctx.sid, wk: ctx.wk, pl, res });
      renderToday();
    } else if (act === "undo") {
      const last = S.undo.pop();
      if (last) mutateSession(last.wk, last.sid, s => { if (s.games[last.pl][last.res] > 0) s.games[last.pl][last.res] -= 1; }, 300);
      renderToday();
    } else if (act === "focus") {
      const f = b.dataset.f;
      mutateSession(ctx.wk, ctx.sid, s => { const i = s.focuses.indexOf(f); if (i >= 0) s.focuses.splice(i, 1); else s.focuses.push(f); }, 400);
      renderToday();
    } else if (act === "rmsess") {
      armOrRun(b, () => removeSession(ctx.wk, ctx.sid));
    }
  });
  // Two-step buttons: first tap arms ("Confirm"), second tap runs. Disarms after 4 s.
  function armOrRun(b, fn, armedLabel) {
    if (b.dataset.armed === "1") { b.dataset.armed = ""; fn(); return; }
    const old = b.textContent;
    b.dataset.armed = "1";
    b.textContent = armedLabel || "Confirm remove";
    setTimeout(() => { if (b.isConnected && b.dataset.armed === "1") { b.dataset.armed = ""; b.textContent = old; } }, 4000);
  }
  function removeSession(wk, sid) {
    (S.removals[wk] = S.removals[wk] || new Set()).add(sid);
    mutateWeek(wk, w => { w.sessions = w.sessions.filter(s => s.id !== sid); }, 0);
    renderToday(); renderWeek(); renderRanks();
  }
  todayBody.addEventListener("input", e => {
    const f = e.target.dataset.sfield;
    if (!f || f === "warmup") return;
    const ctx = cardCtx(e.target);
    if (!ctx) return;
    const v = e.target.value.slice(0, 4000);
    mutateSession(ctx.wk, ctx.sid, s => { if (!s.endedAt) s[f] = v; }, 800);
  });
  todayBody.addEventListener("change", e => {
    if (e.target.dataset.sfield !== "warmup") return;
    const ctx = cardCtx(e.target);
    if (!ctx) return;
    const v = e.target.checked;
    mutateSession(ctx.wk, ctx.sid, s => { if (!s.endedAt) s.warmup = v; }, 0);
  });
  todayBody.addEventListener("submit", e => {
    e.preventDefault();
    if (e.target.id === "adhocForm") { checkIn($("#adhocType").value, null); return; }
    if (e.target.dataset.form === "addfocus") {
      const input = e.target.querySelector("input");
      const raw = input.value.trim().replace(/\s+/g, " ").slice(0, 30);
      if (!raw) return;
      const ctx = cardCtx(e.target);
      const existing = allFocuses().find(f => f.toLowerCase() === raw.toLowerCase());
      const name = existing || raw;
      if (!existing) patchMe({ customFocus: S.me.customFocus.concat([name]) }, 300);
      if (ctx) mutateSession(ctx.wk, ctx.sid, s => { if (!s.focuses.includes(name)) s.focuses.push(name); }, 300);
      input.value = "";
      renderToday();
    }
  });

  /* ---------- My Week ---------- */
  function makeDay() {
    const d = mk("div", "day");
    d.innerHTML =
      '<div class="day-top"><label class="day-on"><input type="checkbox" data-act="dayon"><span class="dname"></span><span class="ddate"></span></label><span class="dsum"></span></div>' +
      '<div class="items"></div><div class="dones"></div>' +
      '<div><button type="button" class="btn sm" data-act="additem">+ Session</button></div>';
    return d;
  }
  function makeItem() {
    const r = mk("div", "item");
    r.innerHTML =
      '<select data-ifield="type" aria-label="Session type">' + TYPE_KEYS.map(k => '<option value="' + k + '">' + TYPES[k].label + "</option>").join("") + '</select>' +
      '<label class="mins"><input type="number" min="0" max="720" step="15" data-ifield="minutes" aria-label="Minutes"> min</label>' +
      '<span class="tm"><button type="button" class="linkbtn" data-act="addtime">+ Time</button>' +
      '<input type="time" data-ifield="time" aria-label="Start time" hidden><button type="button" class="linkbtn" data-act="cleartime" hidden aria-label="Remove time">×</button></span>' +
      '<button type="button" class="btn sm" data-act="rmitem" aria-label="Remove session">×</button>';
    return r;
  }
  function updateItem(r, item) {
    setVal(r.querySelector('[data-ifield="type"]'), item.type);
    setVal(r.querySelector('[data-ifield="minutes"]'), String(item.minutes));
    const t = r.querySelector('[data-ifield="time"]');
    const show = !!item.time || r.dataset.timeOpen === "1";
    t.hidden = !show;
    r.querySelector('[data-act="addtime"]').hidden = show;
    r.querySelector('[data-act="cleartime"]').hidden = !show;
    setVal(t, item.time);
  }
  function renderWeek() {
    if (!S.me) return;
    const wk = S.wk, thisWk = mondayOf(S.today);
    $("#wkLabel").textContent = weekLabel(wk);
    $("#wkThis").hidden = wk === thisWk;
    const w = getWeek(wk);
    const rows = reqRows(weekStats(w, wk));
    renderReqs($("#reqBox"), rows);
    const [vt, vc] = verdictText(rows);
    $("#verdict").textContent = vt;
    $("#verdict").className = vc || "verdict";
    keyed($("#dayList"), weekDates(wk), makeDay, (d, date) => {
      const items = w.plan[date] || [];
      const ses = w.sessions.filter(s => s.date === date);
      d.classList.toggle("on", items.length > 0);
      d.classList.toggle("is-today", date === S.today);
      d.dataset.date = date;
      d.querySelector('[data-act="dayon"]').checked = items.length > 0;
      d.querySelector(".dname").textContent = fmtDate(date, { weekday: "long" });
      d.querySelector(".ddate").textContent = fmtDate(date, { month: "short", day: "numeric" });
      const pMin = sumMin(items, () => true), dMin = sumMin(ses.filter(s => s.endedAt), () => true);
      d.querySelector(".dsum").textContent = [items.length ? fmtDur(pMin) : "", dMin ? "✓ " + fmtDur(dMin) : ""].filter(Boolean).join(" · ");
      keyed(d.querySelector(".items"), items.map(i => i.id), makeItem, (r, id) => updateItem(r, items.find(i => i.id === id)));
      const dl = d.querySelector(".dones");
      dl.textContent = "";
      for (const s of ses) {
        const line = mk("p", "done-line" + (s.endedAt ? "" : " live"), (s.endedAt ? "✓ " : "● ") + TYPES[s.type].label + " · " + (s.endedAt ? fmtDur(s.minutes) : "now"));
        if (s.endedAt) {
          const rb = mk("button", "linkbtn rm", "Remove");
          rb.type = "button";
          rb.dataset.act = "rmsess";
          rb.dataset.sid = s.id;
          line.append(" ", rb);
        }
        dl.append(line);
      }
    });
  }
  const dayCtx = n => { const d = n.closest(".day"); return d ? d.dataset.date : null; };
  const itemCtx = n => { const r = n.closest(".item"); return r ? r.dataset.key : null; };
  const dayList = $("#dayList");
  dayList.addEventListener("change", e => {
    const date = dayCtx(e.target);
    if (!date) return;
    const wk = mondayOf(date);
    if (e.target.dataset.act === "dayon") {
      const on = e.target.checked;
      mutateWeek(wk, w => {
        if (on) { if (!w.plan[date] || !w.plan[date].length) w.plan[date] = [{ id: newId(), type: "ranked", minutes: DEFAULT_MIN.ranked, time: "" }]; }
        else delete w.plan[date];
      }, 400);
      renderWeek(); renderToday();
      return;
    }
    const field = e.target.dataset.ifield, id = itemCtx(e.target);
    if (!field || !id) return;
    const val = e.target.value;
    mutateWeek(wk, w => {
      const it = (w.plan[date] || []).find(i => i.id === id);
      if (!it) return;
      if (field === "type" && TYPES[val]) { const wasDefault = it.minutes === DEFAULT_MIN[it.type]; it.type = val; if (wasDefault) it.minutes = DEFAULT_MIN[val]; }
      else if (field === "minutes") it.minutes = Math.min(720, n0(val));
      else if (field === "time") it.time = isTime(val) ? val : "";
    }, 500);
    renderWeek(); renderToday();
  });
  dayList.addEventListener("click", e => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const date = dayCtx(b);
    if (!date) return;
    const wk = mondayOf(date), act = b.dataset.act;
    if (act === "rmsess") { armOrRun(b, () => removeSession(wk, b.dataset.sid), "Confirm"); return; }
    if (act === "additem") mutateWeek(wk, w => { (w.plan[date] = w.plan[date] || []).push({ id: newId(), type: "training", minutes: DEFAULT_MIN.training, time: "" }); }, 400);
    else if (act === "rmitem") { const id = itemCtx(b); mutateWeek(wk, w => { w.plan[date] = (w.plan[date] || []).filter(i => i.id !== id); if (!w.plan[date].length) delete w.plan[date]; }, 400); }
    else if (act === "addtime") { const r = b.closest(".item"); r.dataset.timeOpen = "1"; renderWeek(); const t = r.querySelector('[data-ifield="time"]'); if (t) t.focus(); return; }
    else if (act === "cleartime") { const r = b.closest(".item"), id = itemCtx(b); r.dataset.timeOpen = "0"; mutateWeek(wk, w => { const it = (w.plan[date] || []).find(i => i.id === id); if (it) it.time = ""; }, 400); }
    else return;
    renderWeek(); renderToday();
  });
  $("#wkPrev").addEventListener("click", () => { S.wk = addDays(S.wk, -7); renderWeek(); });
  $("#wkNext").addEventListener("click", () => { S.wk = addDays(S.wk, 7); renderWeek(); });
  $("#wkThis").addEventListener("click", () => { S.wk = mondayOf(S.today); renderWeek(); });

  /* ---------- Ranks ---------- */
  function tierColor(tier) { if (!tier) return "--t-unranked"; if (tier === "Supersonic Legend") return TIER_COLOR[tier]; return TIER_COLOR[tier.replace(/ (I|II|III)$/, "")] || "--t-unranked"; }
  function tierMark(tier) { if (!tier || tier === "Unranked") return "–"; if (tier === "Supersonic Legend") return "SSL"; const m = tier.match(/ (I|II|III)$/); return m ? m[1] : ""; }
  function rankRows(list, ranks, weekGames) {
    list.textContent = "";
    for (const p of PL) {
      const x = ranks.playlists[p.key];
      const li = mk("li", "rank");
      const badge = mk("span", "badge", tierMark(x.tier));
      badge.style.setProperty("--tier", "var(" + tierColor(x.tier) + ")");
      badge.setAttribute("aria-hidden", "true");
      const main = mk("div");
      main.append(mk("p", "rank-pl", p.name));
      const tr = mk("p", "rank-tier" + (x.tier ? "" : " unset"), x.tier || "—");
      if (x.tier && x.div) tr.append(mk("span", "div", x.div));
      main.append(tr);
      const nums = mk("div", "rank-nums");
      const mmr = mk("p", "mmr", x.mmr !== null ? x.mmr.toLocaleString("en-US") : "—");
      mmr.append(mk("span", "unit", "MMR"));
      const ch = ranks.mmrChange[p.key];
      if (ch) mmr.append(mk("span", "delta " + (ch > 0 ? "up" : "down"), (ch > 0 ? "+" : "−") + Math.abs(ch)));
      const gm = mk("p", "gm", x.games !== null ? x.games.toLocaleString("en-US") + " games" : "");
      if (weekGames) { const g = weekGames[p.key]; if (g.w + g.l) { gm.append(" "); gm.append(mk("b", "", "+" + (g.w + g.l))); } }
      nums.append(mmr, gm);
      li.append(badge, main, nums);
      list.append(li);
    }
  }
  function rankStamp(r) { const t = r.pulledAt && r.pulledAt >= (r.ranksAt || "") ? r.pulledAt : r.ranksAt; return t ? "Updated " + fmtStamp(t) : ""; }
  function renderRanks() {
    if (!S.me) return;
    const wk = mondayOf(S.today);
    rankRows($("#rankList"), S.me.ranks, weekStats(getWeek(wk), wk).games);
    $("#rankUpdated").textContent = rankStamp(S.me.ranks);
  }

  /* ---------- Coach: data ---------- */
  let coachLoading = false;
  async function loadCoach() {
    if (!S.me || S.me.role !== "coach" || coachLoading) return;
    coachLoading = true;
    const wk = S.coachWk;
    try {
      const [p, w] = await Promise.all([api("GET", "coach/players"), api("GET", "coach/weeks/" + wk)]);
      S.roster = {};
      for (const u of p.players || []) { const n = normUser(u); S.roster[n.id] = n; }
      if (wk === S.coachWk) {
        S.rosterWeeks = {};
        for (const x of w.weeks || []) S.rosterWeeks[x.userId] = normWeek(x.data, wk);
      }
      S.rosterLoaded = true;
      if (S.sel && !S.roster[S.sel]) { S.sel = null; S.pdFor = null; }
    } catch (_) {}
    finally { coachLoading = false; }
    renderCoach();
  }
  function rosterIds() {
    const f = S.teamFilter;
    return Object.keys(S.roster).filter(id => {
      const p = S.roster[id];
      if (p.role === "coach") return f === "all" && !!S.rosterWeeks[id] && weekStats(S.rosterWeeks[id], S.coachWk).hasAny;
      return f === "all" || p.team === f;
    }).sort((a, b) => S.roster[a].name.localeCompare(S.roster[b].name, "en", { sensitivity: "base" }));
  }
  function renderTeamTabs() {
    const box = $("#teamTabs");
    box.textContent = "";
    const players = Object.values(S.roster).filter(p => p.role === "player");
    for (const [k, l] of [["all", "All"]].concat(TEAMS)) {
      const n = k === "all" ? players.length : players.filter(p => p.team === k).length;
      const b = mk("button", "tab", l);
      b.type = "button";
      b.setAttribute("aria-pressed", String(S.teamFilter === k));
      b.append(mk("span", "n", String(n)));
      b.addEventListener("click", () => { S.teamFilter = k; pref.set("team", k); renderCoach(); });
      box.append(b);
    }
  }
  function playerStatus(id) {
    const p = S.roster[id], w = S.rosterWeeks[id] || normWeek(null, S.coachWk), wk = S.coachWk, thisWk = mondayOf(S.today);
    if (p.active && wk === thisWk) return "live";
    const st = weekStats(w, wk), rows = reqRows(st);
    if (!st.hasAny && p.createdAt && ymd(new Date(p.createdAt)) > addDays(wk, 6)) return "notyet";
    if (!st.hasAny) return wk < thisWk ? "missed" : "noplan";
    if (rows.length && rows.every(r => r.done >= r.target)) return "done";
    if (wk < thisWk) return "missed";
    if (wk > thisWk) return rows.some(r => r.planned < r.target) ? "behind" : "onpace";
    return rows.some(r => r.planned < r.target || r.done + r.remain < r.target) ? "behind" : "onpace";
  }
  const GROUPS = [["live", "In session"], ["behind", "Behind"], ["onpace", "On pace"], ["done", "Done"], ["noplan", "No plan"], ["missed", "Missed"], ["notyet", "Joined later"]];
  function statusLine(id) {
    const rows = reqRows(weekStats(S.rosterWeeks[id] || normWeek(null, S.coachWk), S.coachWk));
    return rows.map(r => r.key === "ind" ? hrs(r.done) + "/" + hrs(r.target) + " h" : r.done + "/" + r.target + " days").join(" · ");
  }
  function awayMessage(id) {
    const w = S.rosterWeeks[id];
    if (!w) return "";
    const s = w.sessions.filter(x => x.endedAt && (x.next.trim() || x.well.trim())).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    if (!s) return "";
    const t = s.next.trim() || s.well.trim();
    return t.length > 100 ? t.slice(0, 100) + "…" : t;
  }
  const closedGroups = new Set((pref.get("closedGroups") || "").split(",").filter(Boolean));

  /* ---------- Coach: render ---------- */
  function renderCoach() {
    if (!S.me || S.me.role !== "coach") return;
    const thisWk = mondayOf(S.today);
    $("#cwLabel").textContent = weekLabel(S.coachWk);
    $("#cwThis").hidden = S.coachWk === thisWk;
    renderTeamTabs();
    const ids = rosterIds();
    $("#rosterEmpty").hidden = !S.rosterLoaded || ids.length > 0;
    $("#rosterEmpty").textContent = S.teamFilter === "all" ? "No players yet." : "No one on " + teamName(S.teamFilter) + ".";
    const box = $("#rosterList");
    box.hidden = !ids.length;
    box.textContent = "";
    const by = {};
    for (const id of ids) { const g = playerStatus(id); (by[g] = by[g] || []).push(id); }
    for (const [g, label] of GROUPS) {
      const list = by[g];
      if (!list || !list.length) continue;
      const grp = mk("div", "rgroup" + (closedGroups.has(g) ? " closed" : ""));
      const head = mk("button", "rhead");
      head.type = "button";
      head.setAttribute("aria-expanded", String(!closedGroups.has(g)));
      head.append(mk("span", "caret", "▼"), document.createTextNode(label + " (" + list.length + ")"));
      head.addEventListener("click", () => { if (closedGroups.has(g)) closedGroups.delete(g); else closedGroups.add(g); pref.set("closedGroups", Array.from(closedGroups).join(",")); renderCoach(); });
      const ul = mk("div", "rlist");
      for (const id of list) {
        const p = S.roster[id];
        const b = mk("button", "buddy");
        b.type = "button";
        if (S.sel === id) b.setAttribute("aria-current", "true");
        const nm = mk("span", "bname", p.name);
        if (S.teamFilter === "all" && p.team) nm.append(mk("span", "bteam", teamName(p.team)));
        b.append(mk("i", "bstat " + g), nm);
        let line = statusLine(id);
        if (g === "live") line = TYPES[p.active.type].label + " · " + fmtDur(elapsedMin(p.active.startedAt)) + (line ? " · " + line : "");
        if (line) b.append(mk("span", "bline", line));
        const away = awayMessage(id);
        if (away) b.append(mk("span", "baway", away));
        b.addEventListener("click", () => { S.sel = id; renderCoach(); setMin($("#winPlayer"), false); if (matchMedia("(max-width: 979px)").matches) $("#winPlayer").scrollIntoView({ block: "start" }); });
        ul.append(b);
      }
      grp.append(head, ul);
      box.append(grp);
    }
    renderPlayerDetail();
  }

  function renderPlayerDetail() {
    const body = $("#pdBody"), id = S.sel, p = id ? S.roster[id] : null;
    if (!p) {
      S.pdFor = null;
      $("#tPlayer").textContent = "Player";
      body.textContent = "";
      body.append(mk("p", "empty", "Select a player."));
      return;
    }
    if (S.pdFor !== id) { buildPlayerDetail(body, id); S.pdFor = id; }
    $("#tPlayer").textContent = p.name;
    $("#pdName").textContent = p.name;
    const ts = $("#pdTeam");
    if (ts && document.activeElement !== ts) ts.value = p.team || "varsity";
    const link = $("#pdTracker");
    link.hidden = !p.trackerUrl;
    if (p.trackerUrl) link.href = p.trackerUrl;
    const stats = $("#pdStats");
    stats.textContent = "";
    if (p.active && S.coachWk === mondayOf(S.today)) stats.append(mk("p", "status err", "● " + TYPES[p.active.type].label + " · since " + fmtClock(p.active.startedAt)));
    const w = S.rosterWeeks[id] || normWeek(null, S.coachWk);
    const st = weekStats(w, S.coachWk);
    const ranks = mk("ul", "rank-list");
    rankRows(ranks, p.ranks, st.games);
    stats.append(ranks);
    const stamp = rankStamp(p.ranks);
    if (stamp) stats.append(mk("p", "fine", stamp));
    if (!p.trackerUrl) stats.append(mk("p", "fine", "No tracker link"));
    const rows = reqRows(st);
    const reqs = mk("div", "reqs");
    renderReqs(reqs, rows);
    stats.append(reqs);
    const [vt, vc] = verdictText(rows);
    if (vt && st.hasAny) stats.append(mk("p", vc, vt));
    for (const d of weekDates(S.coachWk)) {
      const items = w.plan[d] || [];
      const ses = w.sessions.filter(s => s.date === d).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      if (!items.length && !ses.length) continue;
      const dayBox = mk("div", "pd-day");
      dayBox.append(mk("h4", "", fmtDate(d, { weekday: "long", month: "short", day: "numeric" })));
      if (items.length) dayBox.append(mk("p", "pd-line muted", items.map(i => TYPES[i.type].label + " " + fmtDur(i.minutes) + (i.time ? " · " + fmtTime(i.time) : "")).join("  ·  ")));
      for (const s of ses) {
        const sb = mk("div", "pd-sess" + (s.endedAt ? "" : " live"));
        sb.append(mk("p", "pd-line", (s.endedAt ? "✓ " : "● ") + TYPES[s.type].label + " · " + (s.endedAt ? fmtClock(s.startedAt) + "–" + fmtClock(s.endedAt) + " · " + fmtDur(s.minutes) + (s.edited ? " · edited" : "") : "since " + fmtClock(s.startedAt))));
        const sum = sessionSummary(s);
        if (sum) sb.append(mk("p", "pd-line muted", sum));
        const addRefl = (label, text) => { if (!text.trim()) return; const r = mk("p", "pd-refl"); r.append(mk("b", "", label + ": "), document.createTextNode(text.trim())); sb.append(r); };
        addRefl("Notes", s.did);
        for (const [k, l] of REFL) addRefl(l, s[k]);
        const rrow = mk("div", "row");
        const rb = mk("button", "btn sm danger", "Remove");
        rb.type = "button";
        const sid = s.id, wk = S.coachWk;
        rb.addEventListener("click", () => armOrRun(rb, async () => {
          rb.disabled = true;
          try { await api("DELETE", "coach/players/" + id + "/sessions/" + wk + "/" + sid); await loadCoach(); }
          catch (err) { rb.disabled = false; setStatus($("#pdStatus"), err.message, "err"); }
        }));
        rrow.append(rb);
        sb.append(rrow);
        dayBox.append(sb);
      }
      stats.append(dayBox);
    }
    if (!st.hasAny) stats.append(mk("p", "empty", "Nothing this week."));
  }

  function buildPlayerDetail(body, id) {
    const p = S.roster[id];
    body.textContent = "";
    const top = mk("div", "spread");
    top.append(mk("p", "big-date"));
    top.firstChild.id = "pdName";
    const a = mk("a", "linkbtn", "Tracker ↗");
    a.id = "pdTracker"; a.target = "_blank"; a.rel = "noopener";
    top.append(a);
    body.append(top);

    const acts = mk("div", "row");
    const btn = (label, cls, fn) => { const b = mk("button", "btn sm" + (cls ? " " + cls : ""), label); b.type = "button"; b.addEventListener("click", fn); acts.append(b); return b; };
    const forms = mk("div", "stack");
    const status = mk("p", "status");
    status.id = "pdStatus";
    status.setAttribute("role", "status");
    const closeAll = () => { forms.textContent = ""; };
    const done = (msg) => { closeAll(); setStatus(status, msg, "ok"); };
    const fail = (err) => setStatus(status, err.message, "err");
    const patch = async (bodyObj, msg) => {
      try { const r = await api("PATCH", "coach/players/" + id, bodyObj); S.roster[id] = normUser(r.player); done(msg); renderCoach(); return true; }
      catch (err) { fail(err); return false; }
    };
    const form = (h, inner, submitLabel, onSubmit) => {
      closeAll(); setStatus(status, "");
      const f = mk("form", "sub");
      f.noValidate = true;
      f.innerHTML = "<h3>" + h + "</h3>" + inner + '<div class="row end"><button type="button" class="btn" data-x>Cancel</button><button type="submit" class="btn primary">' + submitLabel + "</button></div>";
      f.querySelector("[data-x]").addEventListener("click", closeAll);
      f.addEventListener("submit", ev => { ev.preventDefault(); onSubmit(f); });
      forms.append(f);
      const first = f.querySelector("input,select");
      if (first) first.focus();
      return f;
    };

    btn("Edit", "", () => {
      const cur = S.roster[id];
      const f = form("Edit", '<label class="fld"><span class="lbl">Name</span><input type="text" name="pname" maxlength="32"></label><label class="fld"><span class="lbl">Tracker link</span><input type="url" name="ptracker" placeholder="rocketleague.tracker.network/…"></label>', "Save", async f2 => {
        await patch({ name: f2.elements.namedItem("pname").value, trackerUrl: f2.elements.namedItem("ptracker").value }, "Saved.");
      });
      f.elements.namedItem("pname").value = cur.name;
      f.elements.namedItem("ptracker").value = cur.trackerUrl;
    });
    if (p.role === "player") btn("Password", "", () => {
      const f = form("New password", '<label class="fld"><span class="sr">New password</span><span class="pw-row"><input type="text" name="pw" maxlength="128" autocomplete="off" spellcheck="false"><button type="button" class="btn sm" data-gen>New</button></span></label>', "Set password", async f2 => {
        const pw = f2.elements.pw.value;
        if (await patch({ password: pw }, "")) showCopy(status, S.roster[id].name, pw);
      });
      f.elements.pw.value = genPassword();
      f.querySelector("[data-gen]").addEventListener("click", () => { f.elements.pw.value = genPassword(); });
    });
    btn("Ranks", "", () => {
      const cur = S.roster[id].ranks;
      const inner = PL.map(q => '<fieldset class="ef"><legend>' + q.name + '</legend><div class="ef-grid">' +
        '<label>Rank<select name="' + q.key + '-tier"><option value="">—</option>' + TIERS.map(t => "<option>" + t + "</option>").join("") + "</select></label>" +
        '<label>Division<select name="' + q.key + '-div"><option value="">—</option>' + DIVS.map(t => "<option>" + t + "</option>").join("") + "</select></label>" +
        '<label>MMR<input type="number" min="0" name="' + q.key + '-mmr"></label>' +
        '<label>Games<input type="number" min="0" name="' + q.key + '-games"></label></div></fieldset>').join("");
      const f = form("Ranks", inner, "Save", async f2 => {
        const ranks = {};
        for (const q of PL) ranks[q.key] = { tier: f2.elements[q.key + "-tier"].value || null, div: f2.elements[q.key + "-div"].value || null, mmr: numOrNull(f2.elements[q.key + "-mmr"].value), games: numOrNull(f2.elements[q.key + "-games"].value) };
        await patch({ ranks }, "Ranks saved.");
      });
      for (const q of PL) {
        const x = cur.playlists[q.key];
        f.elements[q.key + "-tier"].value = x.tier || "";
        f.elements[q.key + "-div"].value = x.div || "";
        f.elements[q.key + "-mmr"].value = x.mmr === null ? "" : String(x.mmr);
        f.elements[q.key + "-games"].value = x.games === null ? "" : String(x.games);
      }
    });
    if (p.role === "player") {
      const rm = btn("Remove", "danger push", () => {
        closeAll(); setStatus(status, "");
        const box = mk("div", "warnbox");
        box.append(mk("p", "", "Remove " + S.roster[id].name + " and all their data?"));
        const row = mk("div", "row end");
        const no = mk("button", "btn", "Cancel"); no.type = "button"; no.addEventListener("click", closeAll);
        const yes = mk("button", "btn primary", "Remove"); yes.type = "button";
        yes.addEventListener("click", async () => {
          yes.disabled = true;
          try { await api("DELETE", "coach/players/" + id); delete S.roster[id]; S.sel = null; S.pdFor = null; renderCoach(); }
          catch (err) { yes.disabled = false; fail(err); }
        });
        row.append(no, yes);
        box.append(row);
        forms.append(box);
      });
      rm.setAttribute("aria-label", "Remove player");
    }
    if (p.role === "player") {
      const tr = mk("label", "pd-team");
      tr.append(mk("span", "lbl", "Roster"));
      const sel = mk("select");
      sel.id = "pdTeam";
      TEAMS.forEach(([k, l]) => sel.append(new Option(l, k)));
      sel.value = p.team || "varsity";
      sel.addEventListener("change", () => patch({ team: sel.value }, "Moved to " + teamName(sel.value) + "."));
      tr.append(sel);
      body.append(tr);
    }
    body.append(acts, status, forms);
    const stats = mk("div", "stack");
    stats.id = "pdStats";
    body.append(stats);
  }

  function showCopy(statusEl, name, pw) {
    statusEl.textContent = "";
    statusEl.className = "status";
    const box = mk("div", "copybox");
    const code = mk("code", "", name + " · " + pw);
    const b = mk("button", "btn sm", "Copy");
    b.type = "button";
    b.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText("Name: " + name + "\nPassword: " + pw + "\n" + location.origin); b.textContent = "Copied"; }
      catch (_) { const r = document.createRange(); r.selectNodeContents(code); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    });
    box.append(code, b);
    statusEl.append(box);
  }

  // Add player
  $("#addOpen").addEventListener("click", () => {
    const f = $("#addForm");
    f.hidden = !f.hidden;
    if (!f.hidden) { $("#addPw").value = genPassword(); $("#addTeam").value = S.teamFilter !== "all" ? S.teamFilter : "varsity"; setStatus($("#addStatus"), ""); $("#addName").focus(); }
  });
  $("#addGen").addEventListener("click", () => { $("#addPw").value = genPassword(); });
  $("#addCancel").addEventListener("click", () => { $("#addForm").hidden = true; });
  $("#addForm").addEventListener("submit", async e => {
    e.preventDefault();
    const st = $("#addStatus");
    const name = $("#addName").value.trim(), pw = $("#addPw").value, tracker = $("#addTracker").value.trim(), team = $("#addTeam").value;
    if (!name) { setStatus(st, "Enter a name.", "err"); return; }
    try {
      const r = await api("POST", "coach/players", { name, password: pw, trackerUrl: tracker, team });
      const u = normUser(r.player);
      S.roster[u.id] = u;
      showCopy(st, u.name, pw);
      $("#addName").value = ""; $("#addTracker").value = ""; $("#addPw").value = genPassword();
      $("#addName").focus();
      renderCoach();
    } catch (err) { setStatus(st, err.message, "err"); }
  });

  // Coach week nav
  const coachWeek = wk => { S.coachWk = wk; S.rosterWeeks = {}; renderCoach(); loadCoach(); };
  $("#cwPrev").addEventListener("click", () => coachWeek(addDays(S.coachWk, -7)));
  $("#cwNext").addEventListener("click", () => coachWeek(addDays(S.coachWk, 7)));
  $("#cwThis").addEventListener("click", () => coachWeek(mondayOf(S.today)));

  // Team settings
  (function buildGoalGrid() {
    const g = $("#goalGrid");
    for (const p of PL) g.insertAdjacentHTML("beforeend",
      '<label for="g-' + p.key + '-min">' + p.short + ' min<input type="number" id="g-' + p.key + '-min" min="0" max="60" step="1"></label>' +
      '<label for="g-' + p.key + '-max">' + p.short + ' max<input type="number" id="g-' + p.key + '-max" min="0" max="60" step="1"></label>');
  })();
  function renderTeamForm(force) {
    if (!S.me || S.me.role !== "coach" || (S.settingsDirty && !force)) return;
    const s = S.settings;
    setVal($("#setTitle"), s.title);
    setVal($("#setHours"), String(s.targets.hours));
    setVal($("#setMinDays"), String(s.targets.minDays));
    for (const p of PL) {
      const g = s.rankedGoals[p.key];
      setVal($("#g-" + p.key + "-min"), g.min === null ? "" : String(g.min));
      setVal($("#g-" + p.key + "-max"), g.max === null ? "" : String(g.max));
    }
  }
  $("#teamForm").addEventListener("input", () => { S.settingsDirty = true; setStatus($("#setStatus"), ""); });
  $("#teamForm").addEventListener("submit", async e => {
    e.preventDefault();
    const goals = {};
    for (const p of PL) goals[p.key] = { min: $("#g-" + p.key + "-min").value, max: $("#g-" + p.key + "-max").value };
    const draft = { title: $("#setTitle").value.trim(), targets: { hours: $("#setHours").value, minDays: $("#setMinDays").value }, rankedGoals: goals };
    try {
      const r = await api("PUT", "coach/settings", { settings: draft });
      S.settings = normSettings(r.settings);
      S.settingsDirty = false;
      renderTeamForm(true);
      setStatus($("#setStatus"), "Saved.", "ok");
      renderAll();
    } catch (err) { setStatus($("#setStatus"), err.message, "err"); }
  });

  /* ---------- Render all ---------- */
  function renderAll() {
    const app = S.phase === "app";
    $("#loadingNote").hidden = S.phase !== "loading";
    $("#winAuth").hidden = S.phase !== "auth";
    if (S.phase === "auth") renderAuth();
    const coach = app && S.me.role === "coach";
    if (!coach && S.view === "coach") S.view = "player";
    $("#viewPlayer").hidden = !(app && S.view === "player");
    $("#viewCoach").hidden = !(app && S.view === "coach");
    if (!app) $("#winAccount").hidden = true;
    renderHeader();
    renderConn();
    renderTaskbar();
    if (!app) return;
    renderToday(); renderWeek(); renderRanks();
    if (coach) { renderCoach(); renderTeamForm(false); }
  }

  /* ---------- Load + refresh ---------- */
  async function loadMine() {
    const [me, wk] = await Promise.all([api("GET", "me"), api("GET", "weeks")]);
    const fresh = normUser(me.me);
    if (dirty.has("me") && S.me) { fresh.active = S.me.active; fresh.customFocus = S.me.customFocus; }
    S.me = fresh;
    const next = {};
    for (const x of wk.weeks || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(x.week)) continue;
      next[x.week] = dirty.has("w:" + x.week) && S.weeks[x.week] ? S.weeks[x.week] : normWeek(x.data, x.week);
    }
    for (const k of dirty) if (k.startsWith("w:")) { const id = k.slice(2); if (!next[id] && S.weeks[id]) next[id] = S.weeks[id]; }
    S.weeks = next;
  }
  async function boot() {
    S.phase = "loading";
    renderAll();
    let st;
    try { st = await api("GET", "state"); }
    catch (err) { S.phase = "auth"; renderAll(); setStatus($("#authStatus"), err.message, "err"); return; }
    S.needsSetup = !!st.needsSetup;
    S.settings = normSettings(st.settings);
    if (!st.me) { S.phase = "auth"; renderAll(); $("#authName").focus(); return; }
    try { await loadMine(); }
    catch (err) { S.phase = "auth"; renderAll(); setStatus($("#authStatus"), err.message, "err"); return; }
    S.phase = "app";
    S.view = S.me.role === "coach" ? (pref.get("view") === "player" ? "player" : "coach") : "player";
    renderAll();
    if (S.me.role === "coach") loadCoach();
  }
  let refreshing = false;
  async function refresh() {
    if (refreshing || S.phase !== "app") return;
    refreshing = true;
    try {
      const st = await api("GET", "state");
      if (!S.settingsDirty) S.settings = normSettings(st.settings);
      await loadMine();
      renderAll();
      if (S.me.role === "coach") await loadCoach();
    } catch (_) {}
    finally { refreshing = false; }
  }

  // Timers: live session clock, day rollover, coach roster refresh, data refresh
  setInterval(() => { const a = S.me && S.me.active; if (a) { const t = document.querySelector("#activeBox .ctime"); if (t) t.textContent = hms(a.startedAt); } }, 1000);
  let ticks = 0;
  setInterval(() => {
    tickClock();
    if (S.phase !== "app") return;
    ticks++;
    const t = todayStr();
    if (t !== S.today) {
      const follow = S.wk === mondayOf(S.today), followC = S.coachWk === mondayOf(S.today);
      S.today = t;
      if (follow) S.wk = mondayOf(t);
      if (followC) S.coachWk = mondayOf(t);
    }
    if (document.visibilityState !== "visible") return;
    if (S.view === "coach") loadCoach();
    else { renderToday(); renderWeek(); }
    if (ticks % 10 === 0) refresh();
  }, 30000);

  tickClock();
  boot();
})();
