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
  const DEFAULT_FOCUS = ["Car control", "Shooting", "Aerials", "Dribbling & flicks", "Rotation", "Defense", "Boost management", "Kickoffs", "Recoveries", "Reads & decisions"];
  const DEFAULT_SETTINGS = {
    title: "Nebraska Esports",
    targets: { ranked: 3, training: 2, minGames: 5, minMinutes: 30 },
    rankedGoals: { duel: { min: 5, max: 10 }, doubles: { min: 15, max: 20 }, standard: { min: null, max: null } }
  };
  const LONG_SESSION_MIN = 360;
  const REFL = [["well", ""], ["cost", ""], ["next", ""]];
  // Reflection prompts fit the kind of session. Same three slots, different questions.
  const REFL_BY_TYPE = {
    ranked: { notes: "Notes", q: [["well", "What went well"], ["cost", "What cost me games"], ["next", "Work on next"]] },
    training: { notes: "What I did", q: [["well", "What clicked"], ["cost", "Still struggling with"], ["next", "Next session focus"]] }
  };
  const reflFor = t => REFL_BY_TYPE[t] || REFL_BY_TYPE.ranked;
  const TEAMS = [["varsity", "Varsity"], ["white", "White"], ["black", "Black"], ["casual", "Casual"]];
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
    s.targets.ranked = Math.round(numIn(t.ranked, s.targets.ranked, 14));
    s.targets.training = Math.round(numIn(t.training, s.targets.training, 14));
    s.targets.minGames = Math.round(numIn(t.minGames, s.targets.minGames, 60));
    s.targets.minMinutes = Math.round(numIn(t.minMinutes, s.targets.minMinutes, 300));
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
      did: str(s.did), well: str(s.well), cost: str(s.cost), next: str(s.next),
      coachNote: str(s.coachNote, 1000), coachNoteAt: typeof s.coachNoteAt === "string" ? s.coachNoteAt : null,
      coachEditedAt: typeof s.coachEditedAt === "string" ? s.coachEditedAt : null
    };
  }
  function normWeek(raw, id) {
    const w = { week: id, sessions: [] };
    if (!isPlain(raw)) return w;
    if (Array.isArray(raw.sessions)) w.sessions = raw.sessions.filter(s => isPlain(s) && typeof s.id === "string" && TYPES[s.type] && typeof s.startedAt === "string").map(normSession);
    return w;
  }

  /* ---------- State ---------- */
  const S = {
    today: todayStr(), phase: "loading", needsSetup: false,
    settings: normSettings(null), me: null, weeks: {},
    view: "player", wk: mondayOf(todayStr()), coachWk: mondayOf(todayStr()),
    roster: {}, rosterWeeks: {}, rosterLoaded: false, sel: null, pdFor: null,
    removals: {}, myHist: [], hist: {}, noteOpen: null, noteDraft: {}, editOpen: null, editEl: null,
    undo: [], saveErr: null, settingsDirty: false, board: null
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
      if (ok && key.startsWith("w:")) scheduleBoard();
      renderConn();
    }
  }
  /* ---------- Leaderboard (ranked games logged this week) ---------- */
  let boardTimer = null;
  function scheduleBoard() { clearTimeout(boardTimer); boardTimer = setTimeout(loadBoard, 1500); }
  async function loadBoard() {
    if (!S.me) return;
    try { const r = await api("GET", "leaderboard/" + mondayOf(S.today)); S.board = Array.isArray(r.rows) ? r.rows : []; }
    catch (_) { return; }
    renderBoard();
  }
  function renderBoard() {
    const me = S.me ? S.me.name.toLowerCase() : "";
    document.querySelectorAll("[data-board]").forEach(list => {
      list.textContent = "";
      if (!S.board) return;
      if (!S.board.length) { list.append(mk("li", "none", "No players yet")); return; }
      S.board.forEach((r, i) => {
        // The top spot is only featured once someone has actually logged games.
        const li = mk("li", [String(r.name).toLowerCase() === me ? "me" : "", i === 0 && r.games > 0 ? "lead" : ""].join(" ").trim());
        li.append(mk("span", "bn", r.name), mk("span", "bg", String(r.games)));
        list.append(li);
      });
    });
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

  /* ---------- Week math: finished sessions count toward the weekly requirement ---------- */
  function gamesIn(s) { return PL.reduce((a, p) => a + s.games[p.key].w + s.games[p.key].l, 0); }
  // A finished session counts toward the week once it clears its type's minimum.
  function counts(s) {
    if (!s.endedAt) return false;
    const T = S.settings.targets;
    return s.type === "ranked" ? gamesIn(s) >= T.minGames : s.minutes >= T.minMinutes;
  }
  function shortReason(s) { const T = S.settings.targets; return s.type === "ranked" ? "under " + T.minGames + " games" : "under " + T.minMinutes + " min"; }
  function weekStats(w) {
    const st = { ranked: 0, training: 0, games: blankGames(), hasAny: false };
    for (const s of w ? w.sessions : []) {
      st.hasAny = true;
      if (!s.endedAt) continue;
      for (const p of PL) { st.games[p.key].w += s.games[p.key].w; st.games[p.key].l += s.games[p.key].l; }
      if (!counts(s)) continue;
      if (s.type === "ranked") st.ranked++;
      else if (s.type === "training") st.training++;
    }
    return st;
  }
  function reqRows(st) {
    const T = S.settings.targets, rows = [];
    if (T.ranked > 0) rows.push({ key: "ranked", label: "Ranked Sessions", target: T.ranked, done: st.ranked });
    if (T.training > 0) rows.push({ key: "training", label: "Training", target: T.training, done: st.training });
    return rows;
  }
  function remaining(rows) { return rows.reduce((a, r) => a + Math.max(0, r.target - r.done), 0); }
  function renderReqs(box, rows) {
    box.textContent = "";
    for (const r of rows) {
      const wrap = mk("div", "req" + (r.done >= r.target ? " met" : ""));
      const pips = mk("span", "pips");
      pips.setAttribute("aria-hidden", "true");
      for (let i = 0; i < Math.min(14, Math.max(r.target, r.done)); i++) pips.append(mk("i", i < r.done ? "on" : ""));
      wrap.append(mk("span", "req-name", r.label), pips, mk("span", "req-nums", r.done + " / " + r.target));
      box.append(wrap);
    }
  }
  function missedText(rows) {
    return rows.filter(r => r.done < r.target).map(r => (r.target - r.done) + " " + (r.key === "ranked" ? "Ranked" : "Training")).join(", ");
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
    const secs = S.view === "coach" ? [["Roster", "#winRoster"], ["Player", "#winPlayer"], ["Board", "#winBoardC"], ["Settings", "#winSettings"]] : [["Today", "#winToday"], ["My Week", "#winWeek"], ["Ranks", "#winRanks"], ["Board", "#winBoard"]];
    for (const [label, sel] of secs) add(label, "sec", null, () => showWin(sel));
    add(S.me.name || "Account", "acct", null, openAccount);
  }

  /* ---------- Auth ---------- */
  function renderAuth() {
    const setup = S.needsSetup;
    $("#tAuth").textContent = setup ? "Create coach account" : "Sign in";
    $("#authPw2Row").hidden = !setup;
    $("#authPw").autocomplete = setup ? "new-password" : "current-password";
    $("#authGo").textContent = setup ? "Create" : "Sign in";
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
    S.phase = "auth"; S.me = null; S.weeks = {}; S.roster = {}; S.rosterWeeks = {}; S.sel = null; S.pdFor = null; S.board = null; S.myHist = []; S.hist = {}; S.noteOpen = null; S.noteDraft = {}; S.editOpen = null; S.editEl = null; S.needsSetup = false;
    setStatus($("#authStatus"), "Signed out. Sign in again.", "err");
    renderAll();
  }
  function openAccount() {
    const w = $("#winAccount");
    w.hidden = false;
    const an = $("#accName");
    an.textContent = S.me.name;
    if (S.me.team) an.append(mk("span", "acc-team", teamName(S.me.team)));
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
    S.phase = "auth"; S.me = null; S.weeks = {}; S.roster = {}; S.rosterWeeks = {}; S.sel = null; S.pdFor = null; S.board = null; S.myHist = []; S.hist = {}; S.noteOpen = null; S.noteDraft = {}; S.editOpen = null; S.editEl = null;
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
      '<p class="counts-hint"></p>' +
      '<div class="warnbox long-warn" hidden><p>Still checked in after 6 hours?</p>' +
      '<div class="row"><input type="number" class="lw-min" min="1" max="1440" step="5" placeholder="Minutes" aria-label="Actual minutes"><button type="button" class="btn" data-act="checkout-set">Check out with this time</button></div></div>' +
      '<label class="chk sec-warm"><input type="checkbox" data-sfield="warmup"> Warmup</label>' +
      '<div class="ctrs sec-ranked"></div>' +
      '<div class="row sec-ranked"><button type="button" class="btn sm" data-act="undo">Undo</button></div>' +
      '<div class="fld sec-focus"><span class="lbl">Focus</span><div class="chips"></div>' +
      '<form class="addf" data-form="addfocus"><input type="text" maxlength="30" placeholder="Add" aria-label="Add a focus area"><button type="submit" class="btn sm">+</button></form></div>' +
      '<label class="fld"><span class="lbl lbl-did">Notes</span><textarea rows="2" data-sfield="did"></textarea></label>' +
      '<div class="refl">' + REFL.map(([k]) => '<label class="fld"><span class="lbl rq" data-k="' + k + '"></span><textarea rows="2" data-sfield="' + k + '"></textarea></label>').join("") + '</div>' +
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
    const T = S.settings.targets, hint = c.querySelector(".counts-hint");
    const have = isRanked ? (s ? gamesIn(s) : 0) : elapsedMin(a.startedAt), need = isRanked ? T.minGames : T.minMinutes;
    hint.hidden = need <= 0;
    hint.classList.toggle("ok", have >= need);
    hint.textContent = have >= need ? "\u2713 Counts toward the week" : isRanked ? have + " of " + need + " games to count toward the week" : "Counts toward the week after " + need + " min";
    const rf = reflFor(a.type);
    c.querySelector(".lbl-did").textContent = rf.notes;
    for (const [k, l] of rf.q) c.querySelector('.rq[data-k="' + k + '"]').textContent = l;
    if (s) {
      c.querySelector('[data-sfield="warmup"]').checked = s.warmup;
      if (isRanked) updateCounters(c.querySelector(".ctrs"), s);
      if (isTrain) renderChips(c.querySelector(".chips"), s.focuses);
      setVal(c.querySelector('[data-sfield="did"]'), s.did);
      for (const [k] of REFL) setVal(c.querySelector('[data-sfield="' + k + '"]'), s[k]);
    }
    c.querySelector('[data-act="undo"]').disabled = !S.undo.some(u => u.sid === a.id);
  }
  function makeDoneCard() {
    const c = mk("div", "card");
    c.innerHTML =
      '<div class="card-head"><p class="ctype"></p><p class="cmeta"></p></div>' +
      '<p class="csum"></p>' +
      '<p class="nc"></p>' +
      '<div class="ro"></div>' +
      '<div class="card-actions"><button type="button" class="btn sm danger" data-act="rmsess">Remove</button></div>';
    return c;
  }
  function fillReadOnly(box, s) {
    box.textContent = "";
    const add = (label, text) => { if (!text || !text.trim()) return; const p = mk("p", "pd-refl"); p.append(mk("b", "", label + ": "), document.createTextNode(text.trim())); box.append(p); };
    const rf = reflFor(s.type);
    add(rf.notes, s.did);
    for (const [k, l] of rf.q) add(l, s[k]);
    if (s.coachNote) { add("Coach", s.coachNote); box.lastChild.classList.add("cn"); }
    box.hidden = !box.children.length;
  }
  // Box-score pieces of a session ("2s 9–5", "Warmup", focus areas), each shown as its own item.
  function sessionParts(s) {
    const bits = [];
    if (s.type === "ranked") for (const p of PL) { const g = s.games[p.key]; if (g.w + g.l > 0) bits.push(p.short + " " + g.w + "\u2013" + g.l); }
    if (s.warmup) bits.push("Warmup");
    if (s.focuses.length) bits.push(s.focuses.join(", "));
    return bits;
  }
  function timeParts(s) {
    return [fmtClock(s.startedAt) + "\u2013" + fmtClock(s.endedAt), fmtDur(s.minutes)].concat(s.edited ? ["edited"] : [], s.coachEditedAt ? ["coach edited"] : []);
  }
  function fillParts(el, parts) { el.textContent = ""; for (const t of parts) el.append(mk("span", "", t)); return el; }
  function updateDoneCard(c, s, wk) {
    c.dataset.week = wk;
    c.dataset.sid = s.id;
    c.querySelector(".ctype").textContent = TYPES[s.type].label;
    fillParts(c.querySelector(".cmeta"), timeParts(s));
    const parts = sessionParts(s);
    fillParts(c.querySelector(".csum"), parts).hidden = !parts.length;
    c.querySelector(".nc").textContent = counts(s) ? "" : "Doesn't count: " + shortReason(s);
    fillReadOnly(c.querySelector(".ro"), s);
  }
  function renderToday() {
    if (!S.me) return;
    const t = S.today, wk = mondayOf(t), w = S.weeks[wk];
    $("#todayDate").textContent = fmtDate(t, { weekday: "long", month: "long", day: "numeric" });
    const done = (w ? w.sessions : []).filter(s => s.date === t && s.endedAt).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const a = S.me.active;
    keyed($("#activeBox"), a ? [a.id] : [], makeActiveCard, c => updateActiveCard(c));
    keyed($("#doneBox"), done.map(s => s.id), makeDoneCard, (c, id) => updateDoneCard(c, done.find(s => s.id === id), wk));
    $("#checkins").hidden = !!a;
  }

  function checkIn(type) {
    if (!S.me || S.me.active || !TYPES[type]) return;
    const now = new Date(), date = S.today, wk = mondayOf(date);
    const s = normSession({ id: newId(), date, type, startedAt: now.toISOString() });
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
    if (act === "checkin") { checkIn(b.dataset.type); return; }
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

  /* ---------- My Week: progress + finished sessions ---------- */
  function renderWeek() {
    if (!S.me) return;
    const wk = S.wk, thisWk = mondayOf(S.today);
    $("#wkLabel").textContent = weekLabel(wk);
    $("#wkThis").hidden = wk === thisWk;
    const w = getWeek(wk), rows = reqRows(weekStats(w));
    renderReqs($("#reqBox"), rows);
    const v = $("#verdict"), left = remaining(rows);
    if (rows.length && !left) { v.textContent = "\u2713 Week complete"; v.className = "verdict good"; }
    else if (rows.length && wk < thisWk) { v.textContent = "Missed: " + missedText(rows); v.className = "verdict short"; }
    else { v.textContent = ""; v.className = "verdict"; }
    const log = $("#weekLog");
    log.textContent = "";
    for (const d of weekDates(wk)) {
      const ses = w.sessions.filter(s => s.date === d).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      if (!ses.length) continue;
      const day = mk("div", "wl-day" + (d === S.today ? " is-today" : ""));
      day.append(mk("p", "wl-date", fmtDate(d, { weekday: "short", month: "short", day: "numeric" })));
      for (const s of ses) {
        const ok = counts(s);
        const line = mk("div", "wl-line" + (s.endedAt ? (ok ? "" : " nc") : " live"));
        line.append(mk("span", "wl-mark", s.endedAt ? (ok ? "\u2713" : "\u2013") : "\u25cf"), mk("span", "wl-type", TYPES[s.type].label), mk("span", "wl-dur", s.endedAt ? fmtDur(s.minutes) : "now"));
        const parts = s.endedAt ? sessionParts(s) : [];
        if (parts.length) line.append(fillParts(mk("span", "wl-sum"), parts));
        if (s.endedAt && !ok) line.append(mk("span", "wl-nc", "doesn't count (" + shortReason(s) + ")"));
        if (s.endedAt) {
          const rb = mk("button", "linkbtn rm", "Remove");
          rb.type = "button";
          rb.dataset.sid = s.id;
          rb.dataset.week = wk;
          line.append(rb);
        }
        day.append(line);
        if (s.coachNote) { const n = mk("p", "wl-note"); n.append(mk("b", "", "Coach: "), document.createTextNode(s.coachNote)); day.append(n); }
      }
      log.append(day);
    }
    if (!log.children.length) log.append(mk("p", "empty", "No sessions yet."));
  }
  $("#weekLog").addEventListener("click", e => {
    const b = e.target.closest("button.rm");
    if (b) armOrRun(b, () => removeSession(b.dataset.week, b.dataset.sid), "Confirm");
  });
  $("#wkPrev").addEventListener("click", () => { S.wk = addDays(S.wk, -7); renderWeek(); });
  $("#wkNext").addEventListener("click", () => { S.wk = addDays(S.wk, 7); renderWeek(); });
  $("#wkThis").addEventListener("click", () => { S.wk = mondayOf(S.today); renderWeek(); });

  /* ---------- Ranks ---------- */
  function tierColor(tier) { if (!tier) return "--t-unranked"; if (tier === "Supersonic Legend") return TIER_COLOR[tier]; return TIER_COLOR[tier.replace(/ (I|II|III)$/, "")] || "--t-unranked"; }
  const TIER_CODE = { Bronze: "B", Silver: "S", Gold: "G", Platinum: "P", Diamond: "D", Champion: "C", "Grand Champion": "GC" };
  function tierMark(tier) { if (!tier || tier === "Unranked") return "–"; if (tier === "Supersonic Legend") return "SSL"; const m = tier.match(/^(.+) (I{1,3})$/); return m ? (TIER_CODE[m[1]] || "") + m[2].length : ""; }
  /* MMR history: points only where MMR changed, ascending by time. */
  function normHist(h) {
    return (Array.isArray(h) ? h : []).filter(x => isPlain(x) && Number.isFinite(Number(x.at)))
      .map(x => ({ at: Number(x.at), duel: numOrNull(x.duel), doubles: numOrNull(x.doubles), standard: numOrNull(x.standard) }))
      .sort((a, b) => a.at - b.at);
  }
  function weekStartMs() { return parseYmd(mondayOf(S.today)).getTime(); }
  // Change since the week started: current MMR minus the last value before Monday (or the first one this week).
  function weekChange(hist, key, now) {
    if (now === null) return null;
    const ws = weekStartMs();
    let base = null;
    for (const h of hist) {
      if (h[key] === null) continue;
      if (h.at < ws) base = h[key];
      else { if (base === null) base = h[key]; break; }
    }
    return base === null ? null : now - base;
  }
  // Step line of MMR over the last 8 weeks: earlier weeks muted, this week in scarlet.
  let sparkId = 0;
  function sparkline(hist, key, now, label) {
    const W = 120, H = 24, PAD = 3, end = Date.now(), from = end - 56 * 864e5;
    let pts = [], prior = null;
    for (const h of hist) {
      if (h[key] === null) continue;
      if (h.at < from) prior = h[key]; else pts.push({ t: h.at, v: h[key] });
    }
    if (prior !== null) pts.unshift({ t: from, v: prior });
    if (now !== null) pts.push({ t: end, v: now });
    if (pts.length < 2 || pts[pts.length - 1].t - pts[0].t < 60000) return null;
    const vs = pts.map(q => q.v), lo = Math.min(...vs), hi = Math.max(...vs);
    const t0 = pts[0].t, x = t => PAD + ((t - t0) / (end - t0 || 1)) * (W - PAD * 2);
    const y = v => hi === lo ? H / 2 : PAD + (1 - (v - lo) / (hi - lo)) * (H - PAD * 2);
    let d = "M" + x(pts[0].t).toFixed(1) + " " + y(pts[0].v).toFixed(1);
    for (let i = 1; i < pts.length; i++) d += " H" + x(pts[i].t).toFixed(1) + " V" + y(pts[i].v).toFixed(1);
    const NS = "http://www.w3.org/2000/svg", id = "spk" + (++sparkId);
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "spark");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("role", "img");
    const desc = label + ", last 8 weeks: " + pts[0].v.toLocaleString("en-US") + " to " + pts[pts.length - 1].v.toLocaleString("en-US") + " (low " + lo.toLocaleString("en-US") + ", high " + hi.toLocaleString("en-US") + ")";
    svg.setAttribute("aria-label", desc);
    const title = document.createElementNS(NS, "title"); title.textContent = desc; svg.append(title);
    const clip = document.createElementNS(NS, "clipPath"); clip.setAttribute("id", id);
    const rect = document.createElementNS(NS, "rect");
    const xw = Math.max(PAD, x(Math.max(t0, weekStartMs())));
    rect.setAttribute("x", xw.toFixed(1)); rect.setAttribute("y", "0"); rect.setAttribute("width", (W - xw).toFixed(1)); rect.setAttribute("height", String(H));
    clip.append(rect); svg.append(clip);
    const old = document.createElementNS(NS, "path"); old.setAttribute("d", d); old.setAttribute("class", "old");
    const cur = document.createElementNS(NS, "path"); cur.setAttribute("d", d); cur.setAttribute("class", "now"); cur.setAttribute("clip-path", "url(#" + id + ")");
    const dot = document.createElementNS(NS, "circle"); dot.setAttribute("cx", x(end).toFixed(1)); dot.setAttribute("cy", y(pts[pts.length - 1].v).toFixed(1)); dot.setAttribute("r", "3");
    svg.append(old, cur, dot);
    return svg;
  }
  function rankRows(list, ranks, hist) {
    list.textContent = "";
    hist = hist || [];
    for (const p of PL) {
      const x = ranks.playlists[p.key];
      const li = mk("li", "rank");
      const badge = mk("span", "badge", tierMark(x.tier));
      badge.style.setProperty("--tier", "var(" + tierColor(x.tier) + ")");
      badge.setAttribute("aria-hidden", "true");
      const main = mk("div");
      main.append(mk("p", "rank-pl", p.name));
      const tr = mk("p", "rank-tier" + (x.tier ? "" : " unset"), x.tier || "\u2014");
      if (x.tier && x.div) tr.append(mk("span", "div", x.div));
      main.append(tr);
      const sp = sparkline(hist, p.key, x.mmr, p.name + " MMR");
      if (sp) main.append(sp);
      const nums = mk("div", "rank-nums");
      const mmr = mk("p", "mmr", x.mmr !== null ? x.mmr.toLocaleString("en-US") : "\u2014");
      mmr.append(mk("span", "unit", "MMR"));
      nums.append(mmr);
      const ch = weekChange(hist, p.key, x.mmr);
      if (ch !== null) nums.append(mk("p", "wk " + (ch > 0 ? "up" : ch < 0 ? "down" : "flat"), (ch > 0 ? "+" : ch < 0 ? "\u2212" : "\u00b1") + Math.abs(ch) + " this week"));
      if (x.games !== null) nums.append(mk("p", "gm", x.games.toLocaleString("en-US") + " games"));
      li.append(badge, main, nums);
      list.append(li);
    }
  }
  function rankStamp(r) { const t = r.pulledAt && r.pulledAt >= (r.ranksAt || "") ? r.pulledAt : r.ranksAt; return t ? "Updated " + fmtStamp(t) : ""; }
  function renderRanks() {
    if (!S.me) return;
    rankRows($("#rankList"), S.me.ranks, S.myHist);
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
    if (S.sel) loadHist(S.sel);
  }
  async function loadHist(id) {
    try { const r = await api("GET", "coach/players/" + id + "/history"); S.hist[id] = normHist(r.history); }
    catch (_) { return; }
    if (S.sel === id) renderPlayerDetail();
  }
  function rosterIds() {
    // Every player, plus the coach only in weeks the coach logged something.
    return Object.keys(S.roster).filter(id => S.roster[id].role === "player" || (!!S.rosterWeeks[id] && S.rosterWeeks[id].sessions.length > 0));
  }
  // Status for the viewed week. Same requirement for everyone.
  function playerStatus(id) {
    const p = S.roster[id], w = S.rosterWeeks[id] || normWeek(null, S.coachWk), wk = S.coachWk, thisWk = mondayOf(S.today);
    const st = weekStats(w), rows = reqRows(st), left = remaining(rows);
    let g = "open";
    if (p.active && wk === thisWk) g = "live";
    else if (rows.length && !left) g = "done";
    else if (p.createdAt && ymd(new Date(p.createdAt)) > addDays(wk, 6)) g = "notyet";
    else if (wk < thisWk) g = "missed";
    return { g, left, st };
  }
  const STATUS_RANK = { live: 0, open: 1, missed: 1, done: 2, notyet: 3 };
  function statusLabel(x) {
    if (x.g === "live") return "In session";
    if (x.g === "done") return "Done";
    if (x.g === "missed") return "Missed";
    if (x.g === "notyet") return "New";
    return x.left + " left";
  }

  /* ---------- Coach: render ---------- */
  function renderCoach() {
    if (!S.me || S.me.role !== "coach") return;
    const thisWk = mondayOf(S.today);
    $("#cwLabel").textContent = weekLabel(S.coachWk);
    $("#cwThis").hidden = S.coachWk === thisWk;
    const ids = rosterIds();
    $("#rosterEmpty").hidden = !S.rosterLoaded || ids.length > 0;
    const box = $("#rosterList");
    box.hidden = !ids.length;
    box.textContent = "";
    if (ids.length) {
      const head = mk("div", "rrow rh");
      head.append(mk("span", "", "Player"), mk("span", "", "Ranked"), mk("span", "", "Training"), mk("span", "", "Status"));
      box.append(head);
    }
    const T = S.settings.targets;
    const rows = ids.map(id => Object.assign({ id }, playerStatus(id))).sort((x, y) =>
      STATUS_RANK[x.g] - STATUS_RANK[y.g] || y.left - x.left || S.roster[x.id].name.localeCompare(S.roster[y.id].name, "en", { sensitivity: "base" }));
    const cell = (done, target) => mk("span", "rc" + (target > 0 && done >= target ? " met" : ""), target > 0 ? done + "/" + target : String(done));
    for (const x of rows) {
      const p = S.roster[x.id];
      const b = mk("button", "rrow");
      b.type = "button";
      if (S.sel === x.id) b.setAttribute("aria-current", "true");
      const nm = mk("span", "rname", p.name);
      if (p.team) nm.append(mk("span", "bteam", teamName(p.team)));
      const pill = mk("span", "pill " + x.g, statusLabel(x));
      if (x.g === "live") pill.title = TYPES[p.active.type].label + " \u00b7 " + fmtDur(elapsedMin(p.active.startedAt));
      b.append(nm, cell(x.st.ranked, T.ranked), cell(x.st.training, T.training), pill);
      b.addEventListener("click", () => { S.sel = x.id; renderCoach(); loadHist(x.id); setMin($("#winPlayer"), false); if (matchMedia("(max-width: 979px)").matches) $("#winPlayer").scrollIntoView({ block: "start" }); });
      box.append(b);
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
    if (S.pdFor !== id) { buildPlayerDetail(body, id); S.pdFor = id; S.noteOpen = null; S.noteDraft = {}; S.editOpen = null; S.editEl = null; }
    $("#tPlayer").textContent = p.name;
    $("#pdName").textContent = p.name;
    const ts = $("#pdTeam");
    if (ts && document.activeElement !== ts) ts.value = p.team || "varsity";
    const link = $("#pdTracker");
    link.hidden = !p.trackerUrl;
    if (p.trackerUrl) link.href = p.trackerUrl;
    const stats = $("#pdStats");
    // Keep an open note editor's focus and cursor through the 30-second refresh.
    const fe = document.activeElement, focusNote = fe && fe.dataset && fe.dataset.noteFor ? { sid: fe.dataset.noteFor, a: fe.selectionStart, b: fe.selectionEnd } : null;
    const focusEdit = S.editEl && fe && S.editEl.contains(fe) ? { el: fe, a: fe.selectionStart, b: fe.selectionEnd } : null;
    let editFound = false;
    stats.textContent = "";
    if (p.active && S.coachWk === mondayOf(S.today)) stats.append(mk("p", "pd-live", (p.active.type === "ranked" ? "In a Ranked Session" : "In Training") + " since " + fmtClock(p.active.startedAt)));
    const w = S.rosterWeeks[id] || normWeek(null, S.coachWk);
    const st = weekStats(w);
    const ranks = mk("ul", "rank-list");
    rankRows(ranks, p.ranks, S.hist[id] || []);
    stats.append(ranks);
    const stamp = rankStamp(p.ranks);
    if (stamp) stats.append(mk("p", "fine", stamp));
    if (!p.trackerUrl) stats.append(mk("p", "fine", "No tracker link"));
    const rows = reqRows(st);
    const reqs = mk("div", "reqs");
    renderReqs(reqs, rows);
    stats.append(reqs);
    for (const d of weekDates(S.coachWk)) {
      const ses = w.sessions.filter(s => s.date === d).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      if (!ses.length) continue;
      const dayBox = mk("div", "pd-day");
      dayBox.append(mk("h4", "", fmtDate(d, { weekday: "long", month: "short", day: "numeric" })));
      for (const s of ses) {
        const ok = counts(s);
        const sb = mk("div", "pd-sess" + (s.endedAt ? (ok ? "" : " nc") : " live"));
        const head = mk("p", "pd-line");
        head.append(mk("span", "wl-mark", s.endedAt ? (ok ? "✓" : "–") : "●"), mk("b", "", TYPES[s.type].label));
        for (const t of s.endedAt ? timeParts(s) : ["since " + fmtClock(s.startedAt)]) head.append(mk("span", "", t));
        sb.append(head);
        if (s.endedAt && S.editOpen === s.id) {
          // The open editor keeps its own form across the 30-second refresh.
          editFound = true;
          if (!S.editEl || S.editEl.dataset.sid !== s.id || S.editEl.dataset.wk !== S.coachWk) S.editEl = buildEditForm(id, S.coachWk, s);
          sb.append(S.editEl);
          dayBox.append(sb);
          continue;
        }
        const parts = sessionParts(s);
        if (parts.length) sb.append(fillParts(mk("p", "pd-line muted"), parts));
        if (s.endedAt && !ok) sb.append(mk("p", "nc", "Doesn't count: " + shortReason(s)));
        const addRefl = (label, text) => { if (!text.trim()) return; const r = mk("p", "pd-refl"); r.append(mk("b", "", label + ": "), document.createTextNode(text.trim())); sb.append(r); };
        const rf = reflFor(s.type);
        addRefl(rf.notes, s.did);
        for (const [k, l] of rf.q) addRefl(l, s[k]);
        const sid = s.id, wk = S.coachWk;
        const rrow = mk("div", "row");
        if (s.endedAt && S.noteOpen === sid) {
          const ed = mk("div", "note-ed");
          const ta = mk("textarea");
          ta.rows = 2; ta.maxLength = 1000; ta.dataset.noteFor = sid;
          ta.setAttribute("aria-label", "Note to " + p.name);
          ta.value = sid in S.noteDraft ? S.noteDraft[sid] : s.coachNote;
          ta.addEventListener("input", () => { S.noteDraft[sid] = ta.value; });
          const er = mk("div", "row end");
          const cancel = mk("button", "btn sm", "Cancel"); cancel.type = "button";
          cancel.addEventListener("click", () => { S.noteOpen = null; delete S.noteDraft[sid]; renderPlayerDetail(); });
          const save = mk("button", "btn sm primary", "Save note"); save.type = "button";
          save.addEventListener("click", async () => {
            save.disabled = true;
            try { await api("PUT", "coach/players/" + id + "/sessions/" + wk + "/" + sid + "/note", { note: ta.value }); S.noteOpen = null; delete S.noteDraft[sid]; await loadCoach(); }
            catch (err) { save.disabled = false; setStatus($("#pdStatus"), err.message, "err"); }
          });
          er.append(cancel, save);
          ed.append(ta, er);
          sb.append(ed);
        } else if (s.coachNote) {
          const n = mk("p", "pd-refl cn"); n.append(mk("b", "", "Your note: "), document.createTextNode(s.coachNote)); sb.append(n);
        }
        if (s.endedAt) {
          const eb = mk("button", "linkbtn", "Edit session"); eb.type = "button";
          eb.addEventListener("click", () => {
            S.editOpen = sid; S.editEl = null; S.noteOpen = null; renderPlayerDetail();
            const first = S.editEl && S.editEl.querySelector("select"); if (first) first.focus();
          });
          rrow.append(eb);
        }
        if (s.endedAt && S.noteOpen !== sid) {
          const nb = mk("button", "linkbtn", s.coachNote ? "Edit note" : "Add note"); nb.type = "button";
          nb.addEventListener("click", () => {
            S.noteOpen = sid; S.noteDraft[sid] = s.coachNote; renderPlayerDetail();
            const t = document.querySelector('[data-note-for="' + sid + '"]'); if (t) t.focus();
          });
          rrow.append(nb);
        }
        const rb = mk("button", "btn sm danger", "Remove");
        rb.type = "button";
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
    if (S.editOpen && !editFound) { S.editOpen = null; S.editEl = null; }
    if (focusEdit && focusEdit.el.isConnected) { focusEdit.el.focus(); try { focusEdit.el.setSelectionRange(focusEdit.a, focusEdit.b); } catch (_) {} }
    if (focusNote) {
      const t = stats.querySelector('[data-note-for="' + focusNote.sid + '"]');
      if (t) { t.focus(); try { t.setSelectionRange(focusNote.a, focusNote.b); } catch (_) {} }
    }
  }

  /* Coach edit of a finished session: type, day, times, warmup, games, focus areas and the player's notes. */
  function hhmm(iso) { const d = new Date(iso); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function buildEditForm(id, wk, s) {
    const p = S.roster[id];
    const f = mk("form", "sub sess-ed");
    f.noValidate = true;
    f.dataset.sid = s.id;
    f.dataset.wk = wk;
    f.innerHTML =
      "<h3>Edit session</h3>" +
      '<div class="ef-grid">' +
      '<label>Type<select name="type"><option value="ranked">' + TYPES.ranked.label + '</option><option value="training">' + TYPES.training.label + "</option></select></label>" +
      '<label>Day<select name="date">' + weekDates(wk).map(d => '<option value="' + d + '">' + fmtDate(d, { weekday: "short", month: "short", day: "numeric" }) + "</option>").join("") + "</select></label>" +
      '<label>Start<input type="time" name="start"></label>' +
      '<label>End<input type="time" name="end"></label></div>' +
      '<label class="chk"><input type="checkbox" name="warmup"> Warmup</label>' +
      '<fieldset class="ef ed-games"><legend>Games</legend><div class="ed-gl">' +
      PL.map(q => '<span class="ed-pl">' + q.name + '</span><label>W<input type="number" min="0" max="300" name="' + q.key + '-w" aria-label="' + q.short + ' wins"></label><label>L<input type="number" min="0" max="300" name="' + q.key + '-l" aria-label="' + q.short + ' losses"></label>').join("") +
      "</div></fieldset>" +
      '<div class="fld ed-focus"><span class="lbl">Focus</span><div class="chips"></div></div>' +
      '<label class="fld"><span class="lbl ed-did"></span><textarea rows="2" name="did" maxlength="4000"></textarea></label>' +
      REFL.map(([k]) => '<label class="fld"><span class="lbl ed-q" data-k="' + k + '"></span><textarea rows="2" name="' + k + '" maxlength="4000"></textarea></label>').join("") +
      '<p class="status" role="status"></p>' +
      '<div class="row end"><button type="button" class="btn" data-x>Cancel</button><button type="submit" class="btn primary">Save session</button></div>';
    const F = n => f.elements.namedItem(n);
    F("type").value = s.type;
    F("date").value = s.date;
    F("start").value = hhmm(s.startedAt);
    F("end").value = hhmm(s.endedAt);
    F("warmup").checked = s.warmup;
    for (const q of PL) { F(q.key + "-w").value = String(s.games[q.key].w); F(q.key + "-l").value = String(s.games[q.key].l); }
    F("did").value = s.did;
    for (const [k] of REFL) F(k).value = s[k];
    // Focus chips: the standard list, this player's own additions, and anything already on the session.
    const chips = f.querySelector(".chips"), seen = new Map();
    DEFAULT_FOCUS.concat(p ? p.customFocus : [], s.focuses).forEach(x => { const k = String(x).trim().toLowerCase(); if (k && !seen.has(k)) seen.set(k, String(x).trim()); });
    for (const name of seen.values()) {
      const b = mk("button", "chip", name); b.type = "button"; b.dataset.f = name;
      b.setAttribute("aria-pressed", String(s.focuses.includes(name)));
      b.addEventListener("click", () => b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")));
      chips.append(b);
    }
    const syncType = () => {
      const t = F("type").value, rf = reflFor(t);
      f.querySelector(".ed-games").hidden = t !== "ranked";
      f.querySelector(".ed-focus").hidden = t !== "training";
      f.querySelector(".ed-did").textContent = rf.notes;
      for (const [k, l] of rf.q) f.querySelector('.ed-q[data-k="' + k + '"]').textContent = l;
    };
    F("type").addEventListener("change", syncType);
    syncType();
    const status = f.querySelector(".status");
    f.querySelector("[data-x]").addEventListener("click", () => { S.editOpen = null; S.editEl = null; renderPlayerDetail(); });
    f.addEventListener("submit", async ev => {
      ev.preventDefault();
      const date = F("date").value, st = F("start").value, en = F("end").value;
      if (!/^\d{1,2}:\d{2}$/.test(st) || !/^\d{1,2}:\d{2}$/.test(en)) { setStatus(status, "Enter a start and end time.", "err"); return; }
      const at = (d, hm) => { const x = parseYmd(d); const [h, m] = hm.split(":").map(Number); x.setHours(h, m, 0, 0); return x; };
      const start = at(date, st), end = at(date, en);
      if (end <= start) end.setDate(end.getDate() + 1); // ran past midnight
      const startSame = date === s.date && st === hhmm(s.startedAt), endSame = startSame && en === hhmm(s.endedAt);
      if (!endSame && end.getTime() > Date.now() + 60000) { setStatus(status, "End time can't be in the future.", "err"); return; }
      const games = {};
      for (const q of PL) games[q.key] = { w: n0(F(q.key + "-w").value), l: n0(F(q.key + "-l").value) };
      const session = {
        type: F("type").value, date,
        startedAt: startSame ? s.startedAt : start.toISOString(),
        endedAt: endSame ? s.endedAt : end.toISOString(),
        warmup: F("warmup").checked, games,
        focuses: Array.from(chips.children).filter(b => b.getAttribute("aria-pressed") === "true").map(b => b.dataset.f),
        did: F("did").value, well: F("well").value, cost: F("cost").value, next: F("next").value
      };
      const save = f.querySelector('button[type="submit"]');
      save.disabled = true;
      try {
        await api("PUT", "coach/players/" + id + "/sessions/" + wk + "/" + s.id, { session });
        S.editOpen = null; S.editEl = null;
        setStatus($("#pdStatus"), "Session saved.", "ok");
        await loadCoach();
      } catch (err) { save.disabled = false; setStatus(status, err.message, "err"); }
    });
    return f;
  }

  function buildPlayerDetail(body, id) {
    const p = S.roster[id];
    body.textContent = "";
    const top = mk("div", "spread");
    top.append(mk("p", "big-date"));
    top.firstChild.id = "pdName";
    const a = mk("a", "linkbtn", "Tracker profile");
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
        if (await patch({ ranks }, "Ranks saved.")) loadHist(id);
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
      tr.append(mk("span", "lbl", "Team"));
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
    // Name and password as two plain lines; Copy puts both (and the site link) on the clipboard.
    const code = mk("span", "copy-info");
    code.append(mk("span", "", "Name: " + name), mk("span", "", "Password: "));
    code.lastChild.append(mk("code", "", pw));
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
    if (!f.hidden) { $("#addPw").value = genPassword(); $("#addTeam").value = "varsity"; setStatus($("#addStatus"), ""); $("#addName").focus(); }
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

  // Settings
  (function buildGoalGrid() {
    const g = $("#goalGrid");
    for (const p of PL) g.insertAdjacentHTML("beforeend",
      '<label for="g-' + p.key + '-min">' + p.short + ' min<input type="number" id="g-' + p.key + '-min" min="0" max="60" step="1"></label>' +
      '<label for="g-' + p.key + '-max">' + p.short + ' max<input type="number" id="g-' + p.key + '-max" min="0" max="60" step="1"></label>');
  })();
  function renderSettingsForm(force) {
    if (!S.me || S.me.role !== "coach" || (S.settingsDirty && !force)) return;
    const s = S.settings;
    setVal($("#setTitle"), s.title);
    setVal($("#setRanked"), String(s.targets.ranked));
    setVal($("#setTraining"), String(s.targets.training));
    setVal($("#setMinGames"), String(s.targets.minGames));
    setVal($("#setMinMinutes"), String(s.targets.minMinutes));
    for (const p of PL) {
      const g = s.rankedGoals[p.key];
      setVal($("#g-" + p.key + "-min"), g.min === null ? "" : String(g.min));
      setVal($("#g-" + p.key + "-max"), g.max === null ? "" : String(g.max));
    }
  }
  $("#settingsForm").addEventListener("input", () => { S.settingsDirty = true; setStatus($("#setStatus"), ""); });
  $("#settingsForm").addEventListener("submit", async e => {
    e.preventDefault();
    const goals = {};
    for (const p of PL) goals[p.key] = { min: $("#g-" + p.key + "-min").value, max: $("#g-" + p.key + "-max").value };
    const draft = { title: $("#setTitle").value.trim(), targets: { ranked: $("#setRanked").value, training: $("#setTraining").value, minGames: $("#setMinGames").value, minMinutes: $("#setMinMinutes").value }, rankedGoals: goals };
    try {
      const r = await api("PUT", "coach/settings", { settings: draft });
      S.settings = normSettings(r.settings);
      S.settingsDirty = false;
      renderSettingsForm(true);
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
    if (coach) { renderCoach(); renderSettingsForm(false); }
  }

  /* ---------- Load + refresh ---------- */
  async function loadMine() {
    const [me, wk, hi] = await Promise.all([api("GET", "me"), api("GET", "weeks"), api("GET", "ranks/history").catch(() => null)]);
    if (hi) S.myHist = normHist(hi.history);
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
    loadBoard();
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
      loadBoard();
      if (S.me.role === "coach") await loadCoach();
    } catch (_) {}
    finally { refreshing = false; }
  }

  // Timers: live session clock, day rollover, coach roster refresh, data refresh
  setInterval(() => { const a = S.me && S.me.active; if (a) { const t = document.querySelector("#activeBox .ctime"); if (t) t.textContent = hms(a.startedAt); } }, 1000);
  let ticks = 0;
  setInterval(() => {
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
    if (S.view === "coach") { loadCoach(); if (ticks % 2 === 0) loadBoard(); }
    else { renderToday(); renderWeek(); }
    if (ticks % 10 === 0) refresh();
  }, 30000);

  boot();
})();
