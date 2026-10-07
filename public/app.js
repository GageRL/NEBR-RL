(() => {
  "use strict";
  // Which school this page is for (set in index.html before anything painted).
  const ROUTE = window.BP_ROUTE || { kind: "school", slug: "nebraska", base: "/", api: "/api/", legacy: true };
  if (ROUTE.kind !== "school") return;
  document.getElementById("schoolApp").hidden = false;

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
  const DEFAULT_THEME = { primary: "#4289d1", secondary: "#ed8727", paper: "clean", fonts: "arena", shape: "angled", header: "color" };
  const DEFAULT_SETTINGS = {
    title: "",
    targets: { ranked: 3, training: 2, minGames: 5, minMinutes: 30 },
    rankedGoals: { duel: { min: 5, max: 10 }, doubles: { min: 15, max: 20 }, standard: { min: null, max: null } },
    targetsLog: [],
    rosters: [{ id: "varsity", name: "Varsity", casual: false }],
    schedRosters: ["varsity"],
    features: { reviews: true, schedule: true, ranks: true, board: true },
    theme: DEFAULT_THEME,
    logo: "", icon: "", tz: "America/Chicago"
  };
  const LONG_SESSION_MIN = 360;
  const REFL = [["well", ""], ["cost", ""], ["next", ""]];
  // Reflection prompts fit the kind of session. Same three slots, different questions.
  const REFL_BY_TYPE = {
    ranked: { notes: "Notes", q: [["well", "What went well"], ["cost", "What cost me games"], ["next", "Work on next"]] },
    training: { notes: "What I did", q: [["well", "What clicked"], ["cost", "Still struggling with"], ["next", "Next session focus"]] }
  };
  const reflFor = t => REFL_BY_TYPE[t] || REFL_BY_TYPE.ranked;
  // Rosters are the school's own (Varsity, JV, ...). A roster marked "no set sessions" has no weekly requirement,
  // and every finished session on it simply counts as logged.
  const rosterList = () => S.settings.rosters;
  const teamName = t => { const x = rosterList().find(r => r.id === t); return x ? x.name : ""; };
  const freeTeam = t => { const x = rosterList().find(r => r.id === t); return !!(x && x.casual); };
  // Everyone on a roster plays: every player, and coaches who also play.
  const plays = u => !!(u && u.team);
  // When someone's weeks start counting: when they joined, or when a coach started playing.
  const playsFrom = u => Math.max(u.createdAt || 0, u.playsSince || 0);
  const feat = f => S.settings.features[f] !== false;

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
  const PREF = ROUTE.legacy ? "ne:" : "bp:" + ROUTE.slug + ":";
  const pref = {
    get(k) { try { return localStorage.getItem(PREF + k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(PREF + k, v); } catch (_) {} }
  };
  function setStatus(el, msg, kind) { el.textContent = msg || ""; el.className = "status" + (kind ? " " + kind : ""); }

  /* ---------- API ---------- */
  class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  async function api(method, path, body) {
    let res;
    try {
      res = await fetch(ROUTE.api + path, { method, credentials: "same-origin", headers: body !== undefined ? { "Content-Type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
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
    s.targetsLog = normLog(raw.targetsLog, true);
    if (Array.isArray(raw.rosters) && raw.rosters.length) s.rosters = raw.rosters.filter(r => isPlain(r) && typeof r.id === "string" && typeof r.name === "string").map(r => ({ id: r.id, name: str(r.name, 20), casual: !!r.casual }));
    s.schedRosters = Array.isArray(raw.schedRosters) ? raw.schedRosters.filter(x => typeof x === "string") : s.rosters.filter(r => !r.casual).map(r => r.id);
    if (isPlain(raw.features)) for (const f of Object.keys(s.features)) s.features[f] = raw.features[f] !== false;
    const th = isPlain(raw.theme) ? raw.theme : {}, isHex = v => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
    s.theme = {
      primary: isHex(th.primary) ? th.primary.toLowerCase() : DEFAULT_THEME.primary,
      secondary: th.secondary === "" ? "" : isHex(th.secondary) ? th.secondary.toLowerCase() : DEFAULT_THEME.secondary,
      paper: ["clean", "white", "cream"].includes(th.paper) ? th.paper : "clean",
      fonts: ["arena", "classic", "block"].includes(th.fonts) ? th.fonts : "arena",
      shape: th.shape === "rounded" ? "rounded" : "angled",
      header: th.header === "light" ? "light" : "color"
    };
    s.logo = str(raw.logo, 200); s.icon = str(raw.icon, 200);
    if (typeof raw.tz === "string" && raw.tz) s.tz = raw.tz;
    return s;
  }
  // Requirement history: entries apply from their Monday on (team entries carry all four numbers; a player's carry overrides or null).
  function normLog(list, team) {
    const n = (v, max) => Math.min(max, Math.max(0, Math.round(Number(v) || 0)));
    const own = v => (v === null || v === undefined ? null : n(v, 14));
    return (Array.isArray(list) ? list : []).filter(e => isPlain(e) && /^\d{4}-\d{2}-\d{2}$/.test(e.from))
      .map(e => team ? { from: e.from, ranked: n(e.ranked, 14), training: n(e.training, 14), minGames: n(e.minGames, 60), minMinutes: n(e.minMinutes, 300) } : { from: e.from, ranked: own(e.ranked), training: own(e.training) })
      .sort((a, b) => a.from.localeCompare(b.from));
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
    return { id: u.id, name: str(u.name, 32), role: u.role === "coach" ? "coach" : "player", team: typeof u.team === "string" && u.team ? u.team : null, trackerUrl: str(u.trackerUrl, 300), ranks: normRanks(u.ranks), active: normActive(u.active), customFocus: Array.isArray(u.customFocus) ? u.customFocus.filter(f => typeof f === "string") : [], targetsLog: normLog(u.targetsLog, false), prefs: normPrefs(u.prefs), createdAt: Number(u.createdAt) || 0, playsSince: Number(u.playsSince) || 0, admin: u.admin === true };
  }
  function normPrefs(p) {
    const out = { layout: {} }, lay = isPlain(p) && isPlain(p.layout) ? p.layout : {};
    for (const v of ["player", "coach"]) if (Array.isArray(lay[v])) out.layout[v] = lay[v].filter(x => isPlain(x) && typeof x.id === "string").map(x => ({ id: x.id, lane: x.lane === 1 ? 1 : 0, wide: !!x.wide, h: ["auto", "s", "m", "l"].includes(x.h) ? x.h : "auto" }));
    return out;
  }
  function normReview(r) {
    return { id: String(r.id), userId: String(r.userId || ""), name: str(r.name, 32), week: str(r.week, 10), sessionId: str(r.sessionId, 40), playlist: str(r.playlist, 10), link: /^https?:\/\//i.test(r.link || "") ? str(r.link, 300) : "", note: str(r.note, 1000), status: r.status === "done" ? "done" : "open", createdAt: Number(r.createdAt) || 0 };
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
    view: "player", page: "home", wk: mondayOf(todayStr()), coachWk: mondayOf(todayStr()),
    roster: {}, rosterWeeks: {}, rosterLoaded: false, sel: null, pdFor: null,
    removals: {}, myHist: [], hist: {}, pweeks: {}, myReviews: [], reviews: [], noteOpen: null, noteDraft: {}, editOpen: null, editEl: null,
    events: [], schedAccess: false, cEvents: [], series: [], evEdit: null, school: null, paused: false, missing: false, adminSkip: false,
    undo: [], saveErr: null, settingsDirty: false, lookPreview: false, board: null
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
    // The admin has no account in this team, so their layout stays on this device.
    if (key === "me" && S.me.admin) { pref.set("adminPrefs", JSON.stringify(S.me.prefs)); return; }
    if (key === "me") return api("PATCH", "me", { active: S.me.active, customFocus: S.me.customFocus, prefs: S.me.prefs });
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
  // Effort, not rank: sessions finished this week, then ranked games. Your own row stands out; nobody is ranked last.
  function renderBoard() {
    const me = S.me ? S.me.name.toLowerCase() : "";
    document.querySelectorAll("[data-board]").forEach(list => {
      list.textContent = "";
      if (!S.board) return;
      if (!S.board.length) { list.append(mk("li", "none", "No players yet")); return; }
      const on = r => (r.sessions || 0) > 0 || r.games > 0;
      for (const r of S.board.filter(on)) {
        const li = mk("li", String(r.name).toLowerCase() === me ? "me" : "");
        const n = r.sessions || 0;
        li.append(mk("span", "bn", r.name), mk("span", "bs", n + (n === 1 ? " session" : " sessions")), mk("span", "bg", r.games + (r.games === 1 ? " game" : " games")));
        list.append(li);
      }
      const idle = S.board.filter(r => !on(r));
      if (idle.length) {
        const li = mk("li", "idle");
        li.append(mk("span", "idle-h", "Not started this week"), mk("span", "idle-n", idle.map(r => r.name).join(", ")));
        list.append(li);
      }
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
  // The requirement that applied in week wk: the team's entry for that week, the player's own numbers on top.
  function logAt(log, wk) { let hit = null; for (const e of log) { if (e.from <= wk) hit = e; else break; } return hit || log[0] || null; }
  function targetsFor(user, wk) {
    const team = logAt(S.settings.targetsLog, wk) || S.settings.targets;
    const T = { ranked: team.ranked, training: team.training, minGames: team.minGames, minMinutes: team.minMinutes, custom: false, free: !!user && freeTeam(user.team) };
    const own = user && user.targetsLog ? logAt(user.targetsLog, wk) : null;
    if (own && own.ranked !== null) { T.ranked = own.ranked; T.custom = true; }
    if (own && own.training !== null) { T.training = own.training; T.custom = true; }
    if (T.free) { T.ranked = 0; T.training = 0; T.custom = false; }
    return T;
  }
  function counts(s, user) {
    if (!s.endedAt) return false;
    const T = targetsFor(user, mondayOf(s.date));
    if (T.free) return true;
    return s.type === "ranked" ? gamesIn(s) >= T.minGames : s.minutes >= T.minMinutes;
  }
  function shortReason(s, user) { const T = targetsFor(user, mondayOf(s.date)); return s.type === "ranked" ? "under " + T.minGames + " games" : "under " + T.minMinutes + " min"; }
  function weekStats(w, user) {
    const st = { ranked: 0, training: 0, games: blankGames(), hasAny: false };
    for (const s of w ? w.sessions : []) {
      st.hasAny = true;
      if (!s.endedAt) continue;
      for (const p of PL) { st.games[p.key].w += s.games[p.key].w; st.games[p.key].l += s.games[p.key].l; }
      if (!counts(s, user)) continue;
      if (s.type === "ranked") st.ranked++;
      else if (s.type === "training") st.training++;
    }
    return st;
  }
  function reqRows(st, user, wk) {
    const T = targetsFor(user, wk), rows = [];
    if (T.free) return rows;
    if (T.ranked > 0) rows.push({ key: "ranked", label: "Ranked Sessions", target: T.ranked, done: st.ranked });
    if (T.training > 0) rows.push({ key: "training", label: "Training", target: T.training, done: st.training });
    return rows;
  }
  function remaining(rows) { return rows.reduce((a, r) => a + Math.max(0, r.target - r.done), 0); }
  // Requirements everywhere use the same meters as Home (count, then a bar of sessions).
  function renderReqs(box, rows) { box.classList.add("meters"); renderMeters(box, rows); }
  function missedText(rows) {
    return rows.filter(r => r.done < r.target).map(r => (r.target - r.done) + " " + (r.key === "ranked" ? "Ranked" : "Training")).join(", ");
  }

  /* ---------- Going to a section: switch to its page, then scroll to it ---------- */
  function showWin(sel) {
    const w = $(sel);
    if (!w) return;
    const pg = w.closest(".page"), view = w.closest(".view");
    if (w.id === "winAccount") setPage("account");
    else if (pg && view) {
      const v = view.id === "viewCoach" ? "coach" : "player";
      if (S.view !== v) { S.view = v; pref.set("view", v); }
      setPage(pg.dataset.page, true);
    }
    w.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
  }

  /* ---------- Header + taskbar ---------- */
  /* ---------- The school's look: colors, background, lettering, corners, header ---------- */
  const PAPERS = { clean: ["#f3f5f8", "#ffffff"], white: ["#ffffff", "#ffffff"], cream: ["#f5f1e7", "#f5f1e7"] };
  function rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function lum(h) { return rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0); }
  function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  // Text on a color: the first choice that reads well, else whichever of white or black reads best.
  function onColor(bg, prefs) { for (const c of prefs) if (contrast(bg, c) >= 4.5) return c; return contrast(bg, "#ffffff") >= contrast(bg, "#000000") ? "#ffffff" : "#000000"; }
  function themeVars(t) {
    const [paper, surface] = PAPERS[t.paper] || PAPERS.clean;
    const ink = t.paper === "cream" ? "#1c1c1c" : "#000000";
    const brand = t.primary, accent = t.secondary || t.primary;
    return {
      vars: {
        "--brand": brand, "--on-brand": onColor(brand, [paper, "#ffffff", ink]), "--brand-text": contrast(brand, paper) >= 3 ? brand : ink,
        "--accent": accent, "--on-accent": onColor(accent, ["#ffffff", ink, paper]), "--accent-text": contrast(accent, paper) >= 3 ? accent : ink,
        "--paper": paper, "--surface": surface, "--ink": ink
      },
      attrs: { shape: t.shape, fonts: t.fonts, header: t.header, paper: t.paper, accent: t.secondary ? "yes" : "no" }
    };
  }
  function applyTheme(settings, preview) {
    const th = themeVars(settings.theme), html = document.documentElement;
    for (const k in th.vars) html.style.setProperty(k, th.vars[k]);
    for (const a in th.attrs) html.dataset[a] = th.attrs[a];
    $("#themeColor").content = settings.theme.header === "light" ? th.vars["--surface"] : th.vars["--brand"];
    if (!preview) { try { localStorage.setItem("bp:theme:" + ROUTE.slug, JSON.stringify(th)); } catch (_) {} }
  }
  // Initials stand in for a logo until the school uploads one.
  function initials(title) {
    const w = String(title || "").split(/\s+/).filter(x => x && !/^(of|the|and|at|esports|university|college)$/i.test(x));
    return (w.length ? w : String(title || "BP").split(/\s+/)).slice(0, 2).map(x => x[0]).join("").toUpperCase() || "BP";
  }
  function paintLogo(img, mono, settings) {
    const src = settings.logo;
    img.hidden = !src;
    if (src && img.getAttribute("src") !== src) img.src = src;
    mono.hidden = !!src;
    mono.textContent = initials(settings.title);
  }
  function renderHeader() {
    const s = S.settings, title = S.missing ? "" : s.title || (S.school && S.school.name) || "";
    $("#logoBox").hidden = S.missing;
    $("#teamTitle").textContent = title;
    document.title = title ? title + " · Backpost" : "Backpost";
    paintLogo($("#schoolLogo"), $("#monoLogo"), s);
    paintLogo($("#authLogo"), $("#authMono"), s);
    $("#authTitle").textContent = title;
    $("#favicon").href = s.icon || "/bp/favicon-32.png";
    $("#touchIcon").href = s.icon || "/bp/apple-touch-icon.png";
    $("#appleTitle").content = title.length > 14 ? title.split(" ")[0] : title || "Backpost";
    const man = ROUTE.api + "manifest";
    if ($("#manifestLink").getAttribute("href") !== man) $("#manifestLink").href = man;
    if (!S.lookPreview) applyTheme(s);
  }
  /* ---------- Pages: four per view, a bottom bar on phones and a sidebar on wide screens ---------- */
  const ICON = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5.5 9.5V20h13V9.5"/>',
    progress: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    schedule: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/>',
    roster: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
    reviews: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M10 8v5l4.5-2.5z"/><path d="M8 21h8"/>',
    settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'
  };
  const icon = k => '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + ICON[k] + "</svg>";
  const PAGES = {
    player: [["home", "Home"], ["progress", "Progress"], ["schedule", "Schedule"], ["team", "Team"]],
    coach: [["roster", "Roster"], ["schedule", "Schedule"], ["reviews", "Reviews"], ["settings", "Settings"]]
  };
  function pagesFor(view) {
    return PAGES[view].filter(([p]) => {
      if (p === "schedule") return feat("schedule") && (view === "coach" || S.schedAccess);
      if (p === "team") return feat("board");
      if (p === "reviews") return feat("reviews");
      return true;
    });
  }
  function pageOk(p) { return p === "account" || pagesFor(S.view).some(([x]) => x === p); }
  // Pages live in the address (#progress) so the back button works on phones.
  function setPage(p, keepScroll) {
    if (!pageOk(p)) p = pagesFor(S.view)[0][0];
    const changed = S.page !== p;
    S.page = p;
    const hash = "#" + p;
    if (location.hash !== hash) { try { history.pushState(null, "", hash); } catch (_) { location.hash = hash; } }
    renderAll();
    if (changed && !keepScroll) window.scrollTo({ top: 0 });
  }
  window.addEventListener("popstate", () => {
    if (S.phase !== "app") return;
    const p = location.hash.slice(1);
    if (p && pageOk(p) && p !== S.page) { S.page = p; renderAll(); }
  });
  function setView(v) {
    S.view = v; pref.set("view", v);
    if (v === "coach") loadCoach();
    setPage(pagesFor(v)[0][0]);
  }
  function renderNav() {
    const nav = $("#appNav"), box = $("#navBtns"), foot = $("#navFoot"), app = S.phase === "app";
    nav.hidden = !app;
    $("#meBtn").hidden = !app || S.me.admin;
    if (!app) return;
    const want = pagesFor(S.view).map(([p, label]) => p + ":" + label).join("|") + "/" + S.view;
    if (box.dataset.k !== want) {
      box.dataset.k = want;
      box.textContent = "";
      for (const [p, label] of pagesFor(S.view)) {
        const b = mk("button", "nav-b");
        b.type = "button"; b.dataset.page = p;
        b.innerHTML = icon(p === "schedule" ? "schedule" : p) + '<span class="nav-l"></span>';
        b.querySelector(".nav-l").textContent = label;
        b.addEventListener("click", () => setPage(p));
        box.append(b);
      }
    }
    box.querySelectorAll(".nav-b").forEach(b => { if (b.dataset.page === S.page) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    // Sidebar foot (wide screens): who's signed in, and the coach's own training.
    foot.textContent = "";
    if (S.me.admin) {
      const a = mk("a", "nav-acct", "Backpost admin"); a.href = "/admin"; foot.append(a);
    } else {
      const acct = mk("button", "nav-acct" + (S.page === "account" ? " on" : ""));
      acct.type = "button";
      acct.append(mk("span", "me-init", initials(S.me.name)), mk("span", "nav-acct-n", S.me.name));
      if (S.page === "account") acct.setAttribute("aria-current", "page");
      acct.addEventListener("click", () => setPage("account"));
      foot.append(acct);
      if (S.me.role === "coach") {
        const sw = mk("button", "nav-switch", S.view === "coach" ? "My training" : "Coach view");
        sw.type = "button";
        sw.addEventListener("click", () => setView(S.view === "coach" ? "player" : "coach"));
        foot.append(sw);
      }
    }
    $("#meInit").textContent = initials(S.me.name);
    $("#meLabel").textContent = "Account: " + S.me.name;
    $("#meBtn").classList.toggle("on", S.page === "account");
    rvBadge();
  }
  $("#meBtn").addEventListener("click", () => setPage(S.page === "account" ? pagesFor(S.view)[0][0] : "account"));
  document.addEventListener("click", e => { const g = e.target.closest("[data-go]"); if (g) setPage(g.dataset.go); });

  // Number of replay reviews waiting, on the Reviews tab (updated in place so focus stays put).
  function rvBadge() {
    const b = document.querySelector('#navBtns .nav-b[data-page="reviews"]');
    if (!b) return;
    const n = S.reviews.filter(r => r.status === "open").length;
    if (n) { b.dataset.count = String(n); b.setAttribute("aria-label", "Reviews, " + n + " waiting"); }
    else { delete b.dataset.count; b.removeAttribute("aria-label"); }
  }

  /* ---------- Auth ---------- */
  function renderAuth() {
    $("#tAuth").textContent = "Sign in";
    $("#authForm").querySelectorAll("input,button").forEach(x => { x.disabled = S.paused; });
    if (S.paused) setStatus($("#authStatus"), "This team is paused on Backpost. Check with your coach.", "err");
  }
  $("#authForm").addEventListener("submit", async e => {
    e.preventDefault();
    const st = $("#authStatus"), go = $("#authGo");
    const name = $("#authName").value.trim(), pw = $("#authPw").value;
    if (!name || !pw) { setStatus(st, "Enter your name and password.", "err"); return; }
    go.disabled = true;
    setStatus(st, "");
    try {
      await api("POST", "login", { name, password: pw });
      $("#authPw").value = "";
      await boot();
    } catch (err) { setStatus(st, err.message, "err"); }
    finally { go.disabled = false; }
  });
  function signedOut() {
    if (S.phase === "auth") return;
    for (const k of Object.keys(timers)) { clearTimeout(timers[k]); delete timers[k]; }
    dirty.clear();
    S.phase = "auth"; S.me = null; S.weeks = {}; S.roster = {}; S.rosterWeeks = {}; S.sel = null; S.pdFor = null; S.board = null; S.myHist = []; S.hist = {}; S.noteOpen = null; S.noteDraft = {}; S.editOpen = null; S.editEl = null; S.pweeks = {}; S.myReviews = []; S.reviews = []; S.events = []; S.cEvents = []; S.series = []; S.evEdit = null; S.needsSetup = false;
    setStatus($("#authStatus"), "Signed out. Sign in again.", "err");
    renderAll();
  }
  function renderAccount() {
    if (!S.me || S.me.admin) return;
    const coach = S.me.role === "coach";
    $("#accName").textContent = S.me.name + (coach ? (S.me.team ? ", coach and " + teamName(S.me.team) + " player" : ", coach") : S.me.team ? ", " + teamName(S.me.team) : "");
    // A coach switches between the coach view and their own training here (phones) or in the sidebar.
    $("#accSwitch").hidden = !coach;
    $("#accView").textContent = S.view === "coach" ? "Switch to my training" : "Back to the coach view";
    // A coach can put themselves on a roster to play.
    $("#accPlay").hidden = !coach;
    if (coach && document.activeElement !== $("#accTeam")) teamSelect($("#accTeam"), true, S.me.team);
  }
  $("#accView").addEventListener("click", () => setView(S.view === "coach" ? "player" : "coach"));
  // Roster picker. For a coach the first choice is not playing.
  function teamSelect(sel, coach, value) {
    const opts = (coach ? [["", "Doesn't play"]] : []).concat(rosterList().map(r => [r.id, r.name]));
    const k = JSON.stringify(opts);
    if (sel.dataset.k !== k) { sel.dataset.k = k; sel.textContent = ""; opts.forEach(([v, t]) => sel.append(new Option(t, v))); }
    sel.value = value || "";
  }
  $("#accTeam").addEventListener("change", async () => {
    const sel = $("#accTeam"), st = $("#accTeamStatus"), team = sel.value || null;
    sel.disabled = true;
    try {
      const r = await api("PATCH", "coach/players/" + S.me.id, { team });
      S.me.team = normUser(r.player).team;
      setStatus(st, team ? "You play on " + teamName(team) + " now. Its schedule is under My training." : "You're off the roster. You're still a coach.", "ok");
      await refresh();
    } catch (err) { setStatus(st, err.message, "err"); sel.value = S.me.team || ""; }
    finally { sel.disabled = false; }
  });
  $("#pwForm").addEventListener("submit", async e => {
    e.preventDefault();
    const st = $("#pwStatus");
    try {
      await api("POST", "password", { current: $("#pwCur").value, next: $("#pwNew").value });
      $("#pwCur").value = ""; $("#pwNew").value = "";
      setStatus(st, "Password changed.", "ok");
    } catch (err) { setStatus(st, err.message, "err"); }
  });
  // The admin can still sign in with a team account here (that sign-in comes first once it exists).
  $("#adminMember").addEventListener("click", () => {
    flushAll();
    S.adminSkip = true;
    S.phase = "auth"; S.me = null; S.roster = {}; S.rosterWeeks = {}; S.sel = null; S.pdFor = null; S.reviews = []; S.cEvents = []; S.evEdit = null;
    renderAll();
    setStatus($("#authStatus"), "Sign in with your team account. You stay signed in as the Backpost admin.", "");
    $("#authName").focus();
  });
  $("#signOff").addEventListener("click", async () => {
    flushAll();
    // This device stops getting the old account's notifications.
    try { await api("POST", "logout", pushSub ? { endpoint: pushSub.endpoint } : {}); } catch (_) {}
    if (pushSub) { try { await pushSub.unsubscribe(); } catch (_) {} pushSub = null; }
    pushSynced = false;
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
      '<p class="live-focus" hidden><b>Focus</b> <span></span></p>' +
      '<div class="warnbox long-warn" hidden><p>Still checked in after 6 hours?</p>' +
      '<div class="row"><input type="number" class="lw-min" min="1" max="1440" step="5" placeholder="Minutes" aria-label="Actual minutes"><button type="button" class="btn" data-act="checkout-set">Check out with this time</button></div></div>' +
      '<label class="chk sec-warm"><input type="checkbox" data-sfield="warmup"> Warmup</label>' +
      '<div class="ctrs sec-ranked"></div>' +
      '<div class="row sec-ranked"><button type="button" class="btn sm" data-act="undo">Undo</button></div>' +
      '<div class="fld sec-focus"><span class="lbl">Focus</span><div class="chips"></div>' +
      '<form class="addf" data-form="addfocus"><input type="text" maxlength="30" placeholder="Add" aria-label="Add a focus area"><button type="submit" class="btn sm">+</button></form></div>' +
      '<label class="fld"><span class="lbl lbl-did">Notes</span><textarea rows="2" data-sfield="did"></textarea></label>' +
      '<div class="refl">' + REFL.map(([k]) => '<label class="fld"><span class="lbl rq" data-k="' + k + '"></span><textarea rows="2" data-sfield="' + k + '"></textarea></label>').join("") + '</div>' +
      '<div class="rv sec-ranked"><div class="rv-list"></div>' +
      '<button type="button" class="linkbtn rv-open" data-act="rv-open">Request a replay review</button>' +
      '<form class="sub rv-form" data-form="review" novalidate hidden><h3>Replay review</h3><div class="add-grid">' +
      '<label class="fld"><span class="lbl">Playlist</span><select name="rv-pl"><option value="">Any</option>' + PL.map(q => '<option value="' + q.key + '">' + q.name + "</option>").join("") + "</select></label>" +
      '<label class="fld"><span class="lbl">Replay link (optional)</span><input type="url" name="rv-link" maxlength="300" placeholder="ballchasing.com/replay/…"></label></div>' +
      '<label class="fld"><span class="lbl">What should Coach look at?</span><textarea name="rv-note" rows="2" maxlength="1000"></textarea></label>' +
      '<p class="status" role="status"></p><div class="row end"><button type="button" class="btn" data-act="rv-cancel">Cancel</button><button type="submit" class="btn primary">Send request</button></div></form></div>' +
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
    c.querySelector(".rv").hidden = !isRanked || !feat("reviews");
    c.querySelector(".sec-focus").hidden = !isTrain;
    const T = targetsFor(S.me, a.week), hint = c.querySelector(".counts-hint");
    const have = isRanked ? (s ? gamesIn(s) : 0) : elapsedMin(a.startedAt), need = isRanked ? T.minGames : T.minMinutes;
    hint.hidden = need <= 0 || T.free;
    hint.classList.toggle("ok", have >= need);
    hint.textContent = have >= need ? "\u2713 Counts toward the week" : isRanked ? "Counts at " + need + " games \u00b7 " + have + " so far" : "Counts after " + need + " min";
    const lf = c.querySelector(".live-focus"), fx = lastFocus(a.id);
    lf.hidden = !fx;
    if (fx) lf.querySelector("span").textContent = fx.text;
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
    const rl = c.querySelector(".rv-list"), mine = S.myReviews.filter(r => r.sessionId === a.id);
    rl.textContent = "";
    if (mine.length) rl.append(reviewSummary(mine));
    rl.hidden = !mine.length;
  }
  const plName = k => { const q = PL.find(x => x.key === k); return q ? q.name : ""; };
  function reviewSummary(list) {
    const open = list.filter(r => r.status !== "done").length, p = mk("p", "rv-item");
    if (!open) p.append(mk("b", "", "\u2713 Replay " + (list.length === 1 ? "review" : "reviews") + " done"));
    else if (list.length === 1) p.append(mk("b", "", "Replay review requested"), document.createTextNode(" " + [plName(list[0].playlist), "waiting for Coach"].filter(Boolean).join(", ")));
    else p.append(mk("b", "", open + " replay reviews requested,"), document.createTextNode(" waiting for Coach"));
    return p;
  }

  function makeDoneCard() {
    const c = mk("div", "card");
    c.innerHTML =
      '<div class="card-head"><p class="ctype"></p><p class="cmeta"></p></div>' +
      '<p class="csum"></p>' +
      '<p class="nc"></p>' +
      '<div class="ro"></div>' +
      '<div class="card-actions"><button type="button" class="linkbtn rank-nudge" data-act="rank-nudge" hidden>Rank changed? Update it</button><button type="button" class="btn sm danger" data-act="rmsess">Remove</button></div>';
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
    c.querySelector(".cmeta").textContent = fmtClock(s.startedAt) + "–" + fmtClock(s.endedAt) + " · " + fmtDur(s.minutes) + (s.edited ? " · edited" : "") + (s.coachEditedAt ? " · coach edited" : "");
    const sum = sessionSummary(s), sumEl = c.querySelector(".csum");
    sumEl.textContent = sum;
    sumEl.hidden = !sum;
    c.querySelector(".nc").textContent = counts(s, S.me) ? "" : "Doesn't count: " + shortReason(s, S.me);
    // After a Ranked Session, until the player updates their ranks.
    const r = S.me.ranks.ranksAt;
    c.querySelector(".rank-nudge").hidden = !(s.type === "ranked" && feat("ranks") && !(r && r >= s.endedAt));
    fillReadOnly(c.querySelector(".ro"), s);
  }
  function renderToday() {
    if (!S.me) return;
    const t = S.today, wk = mondayOf(t), w = S.weeks[wk];
    $("#todayLabel").textContent = fmtDate(t, { weekday: "long", month: "short", day: "numeric" });
    const done = (w ? w.sessions : []).filter(s => s.date === t && s.endedAt).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const a = S.me.active;
    keyed($("#activeBox"), a ? [a.id] : [], makeActiveCard, c => updateActiveCard(c));
    keyed($("#doneBox"), done.map(s => s.id), makeDoneCard, (c, id) => updateDoneCard(c, done.find(s => s.id === id), wk));
    $("#checkins").hidden = !!a;
    document.querySelector(".page-home").classList.toggle("is-live", !!a);
    renderHome();
  }

  /* ---------- Home: this week, your focus, the coach's last note, what's next ---------- */
  function finishedSessions() {
    const out = [];
    for (const wk of Object.keys(S.weeks)) for (const s of S.weeks[wk].sessions) if (s.endedAt) out.push(s);
    return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  // What the player said to work on next, from their latest finished session (not the one in progress).
  function lastFocus(skipId) {
    const s = finishedSessions().find(x => x.id !== skipId && x.next && x.next.trim());
    return s ? { text: s.next.trim(), s } : null;
  }
  const sessWhen = s => TYPES[s.type].label + ", " + fmtDate(s.date, { weekday: "short", month: "short", day: "numeric" });
  function renderMeters(box, rows) {
    box.textContent = "";
    for (const r of rows) {
      const met = r.done >= r.target;
      const m = mk("div", "meter" + (met ? " met" : ""));
      const top = mk("p", "meter-top");
      top.append(mk("span", "meter-name", r.label), mk("span", "meter-n", (met ? "✓ " : "") + r.done + " of " + r.target));
      const bar = mk("div", "meter-bar");
      bar.setAttribute("aria-hidden", "true");
      for (let i = 0; i < Math.min(14, Math.max(r.target, r.done)); i++) bar.append(mk("i", i < r.done ? "on" : ""));
      m.append(top, bar);
      box.append(m);
    }
  }
  function renderHome() {
    if (!S.me) return;
    const wk = mondayOf(S.today), st = weekStats(getWeek(wk), S.me), rows = reqRows(st, S.me, wk), left = remaining(rows);
    $("#homeWeekLabel").textContent = weekLabel(wk);
    renderMeters($("#homeReqs"), rows);
    // Say what's left, not a percentage: the closer the goal, the more it pulls.
    const daysLeft = 7 - ((parseYmd(S.today).getDay() + 6) % 7), note = $("#homeWeekNote");
    note.className = "week-note";
    if (!rows.length) { const n = st.ranked + st.training; note.textContent = n ? n + (n === 1 ? " session" : " sessions") + " logged this week." : "Your roster has no set sessions. Everything you log still counts on Progress."; }
    else if (!left) { note.textContent = "Week complete. Anything more is extra work."; note.classList.add("good"); }
    else note.textContent = left + (left === 1 ? " more session" : " more sessions") + " to go, " + (daysLeft === 1 ? "last day of the week." : daysLeft + " days left.");
    const fx = lastFocus(S.me.active ? S.me.active.id : null), fb = $("#homeFocus");
    fb.hidden = false; fb.textContent = "";
    fb.append(mk("p", "card-k", "Your focus"));
    if (fx) fb.append(mk("p", "focus-text", fx.text), mk("p", "fine", "From your " + sessWhen(fx.s)));
    else fb.append(mk("p", "fine", "After each session, write one thing to work on next. It shows up here and when you check in."));
    const cut = addDays(S.today, -14), cn = finishedSessions().find(s => s.coachNote && s.date >= cut), nb = $("#homeNote");
    nb.hidden = !cn; nb.textContent = "";
    if (cn) nb.append(mk("p", "card-k", "Coach note"), mk("p", "note-text", cn.coachNote), mk("p", "fine", "On your " + sessWhen(cn)));
    renderHomeNext();
  }
  function renderHomeNext() {
    const box = $("#homeNext"), win = $("#winNext");
    const up = feat("schedule") && S.schedAccess ? S.events.filter(e => evMs(e) >= Date.now() - 3 * 3600e3).sort((a, b) => evMs(a) - evMs(b)) : [];
    win.hidden = !up.length;
    box.textContent = "";
    if (!up.length) return;
    const e = up[0], d = ymd(new Date(e.startsAt));
    const h = mk("h3", "ev-day", fmtDate(d, { weekday: "short", month: "short", day: "numeric" }));
    const tag = dayTag(d);
    if (tag) h.append(mk("span", "ev-tag", tag));
    const ul = mk("ul", "ev-list");
    ul.append(evItem(e, false));
    box.append(h, ul);
  }

  /* ---------- Progress: focus history ---------- */
  function renderFocusHistory() {
    if (!S.me) return;
    const all = finishedSessions(), list = $("#focusList"), tags = $("#focusTags");
    list.textContent = "";
    const items = all.filter(s => s.next && s.next.trim()).slice(0, 8);
    if (!items.length) list.append(mk("li", "empty", "What you choose to work on after each session builds up here."));
    for (const s of items) {
      const li = mk("li", "focus-item");
      li.append(mk("p", "focus-text", s.next.trim()), mk("p", "fine", sessWhen(s)));
      if (s.coachNote) { const n = mk("p", "wl-note"); n.append(mk("b", "", "Coach: "), document.createTextNode(s.coachNote)); li.append(n); }
      list.append(li);
    }
    // Training focus areas over the last 8 weeks, most worked on first.
    const since = addDays(mondayOf(S.today), -49), count = new Map();
    for (const s of all) if (s.date >= since) for (const f of s.focuses) count.set(f, (count.get(f) || 0) + 1);
    const top = Array.from(count.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
    tags.textContent = "";
    tags.hidden = !top.length;
    if (!top.length) return;
    tags.append(mk("p", "card-k", "Training focus, last 8 weeks"));
    const ul = mk("ul", "tag-list");
    for (const [f, n] of top) { const li = mk("li", "tag"); li.append(document.createTextNode(f + " "), mk("b", "", "×" + n)); ul.append(li); }
    tags.append(ul);
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
    if (act === "rank-nudge") { setPage("progress"); openRankForm(); $("#winRanks").scrollIntoView({ block: "start" }); return; }
    if (act === "checkout-set") { const v = n0(b.closest(".warnbox").querySelector(".lw-min").value); if (v > 0) checkOut(v); return; }
    if (act === "rv-open" || act === "rv-cancel") {
      const card = b.closest(".card"), f = card.querySelector(".rv-form");
      f.hidden = act === "rv-cancel";
      card.querySelector(".rv-open").hidden = !f.hidden;
      if (!f.hidden) f.querySelector("textarea").focus();
      return;
    }
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
  async function sendReview(f) {
    const ctx = cardCtx(f), st = f.querySelector(".status"), go = f.querySelector('button[type="submit"]');
    const note = f.elements.namedItem("rv-note").value.trim();
    if (!ctx) return;
    if (!note) { setStatus(st, "Say what Coach should look at.", "err"); return; }
    go.disabled = true;
    // The session has to be saved before Coach can get a request for it.
    const key = "w:" + ctx.wk;
    if (timers[key]) { clearTimeout(timers[key]); delete timers[key]; flush(key); }
    for (let i = 0; i < 40 && (inflight.has(key) || again.has(key)); i++) await sleep(150);
    try {
      const r = await api("POST", "reviews", { week: ctx.wk, sessionId: ctx.sid, playlist: f.elements.namedItem("rv-pl").value, link: f.elements.namedItem("rv-link").value, note });
      S.myReviews.unshift(normReview(r.review));
      f.reset(); f.hidden = true; setStatus(st, "");
      f.closest(".card").querySelector(".rv-open").hidden = false;
      renderToday(); renderWeek();
    } catch (err) { setStatus(st, err.message, "err"); }
    finally { go.disabled = false; }
  }
  todayBody.addEventListener("submit", e => {
    e.preventDefault();
    if (e.target.dataset.form === "review") { sendReview(e.target); return; }
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

  /* ---------- Past weeks: one line per finished week, newest first (12 weeks) ---------- */
  function renderPast(box, user, weekOf, pick, current) {
    box.textContent = "";
    const thisWk = mondayOf(S.today), first = user.createdAt ? mondayOf(ymd(new Date(user.createdAt))) : thisWk, list = [];
    for (let wk = addDays(thisWk, -7); wk >= first && list.length < 12; wk = addDays(wk, -7)) list.push(wk);
    if (!list.length) return;
    box.append(mk("h3", "", "Past weeks"));
    const frac = (done, target) => target > 0 ? done + "/" + target : String(done);
    for (const wk of list) {
      const st = weekStats(weekOf(wk), user), T = targetsFor(user, wk), rows = reqRows(st, user, wk);
      const games = PL.reduce((a, q) => a + st.games[q.key].w + st.games[q.key].l, 0);
      // Only weeks they were playing get a verdict (a coach who doesn't play, or before they started, gets none).
      const counted = plays(user) && (!playsFrom(user) || wk >= mondayOf(ymd(new Date(playsFrom(user)))));
      const status = rows.length && counted ? (remaining(rows) ? "Missed" : "Done") : "";
      const b = mk("button", "past-row" + (status === "Done" ? " met" : ""));
      b.type = "button";
      if (wk === current) b.setAttribute("aria-current", "true");
      b.append(mk("span", "past-wk", weekLabel(wk)), mk("span", "past-n", "Ranked " + frac(st.ranked, T.ranked)), mk("span", "past-n", "Training " + frac(st.training, T.training)), mk("span", "past-g", games + " games"), mk("span", "past-st", status));
      b.addEventListener("click", () => pick(wk));
      box.append(b);
    }
  }

  /* ---------- My Week: progress + finished sessions ---------- */
  function renderWeek() {
    if (!S.me) return;
    const wk = S.wk, thisWk = mondayOf(S.today);
    $("#wkLabel").textContent = weekLabel(wk);
    $("#wkThis").hidden = wk === thisWk;
    const w = getWeek(wk), rows = reqRows(weekStats(w, S.me), S.me, wk);
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
        const ok = counts(s, S.me);
        const line = mk("div", "wl-line" + (s.endedAt ? (ok ? "" : " nc") : " live"));
        line.append(mk("span", "", (s.endedAt ? (ok ? "\u2713 " : "\u2013 ") : "\u25cf ") + TYPES[s.type].label + " \u00b7 " + (s.endedAt ? fmtDur(s.minutes) : "now")));
        const sum = s.endedAt ? sessionSummary(s) : "";
        if (sum) line.append(mk("span", "wl-sum", sum));
        if (s.endedAt && !ok) line.append(mk("span", "wl-nc", "doesn't count (" + shortReason(s, S.me) + ")"));
        const rvs = S.myReviews.filter(r => r.sessionId === s.id);
        if (rvs.length) line.append(mk("span", "rv-tag", rvs.every(r => r.status === "done") ? "\u2713 Replay reviewed" : "Replay review requested"));
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
    renderPast($("#pastBox"), S.me, getWeek, w2 => { S.wk = w2; renderWeek(); $("#winWeek").scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" }); }, wk);
    renderFocusHistory();
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
  function sparkline(hist, key, now, label, W, H) {
    W = W || 120; H = H || 24;
    const PAD = 4, end = Date.now(), from = end - 56 * 864e5;
    let pts = [], prior = null;
    for (const h of hist) {
      if (h[key] === null) continue;
      if (h.at < from) prior = h[key]; else pts.push({ t: h.at, v: h[key] });
    }
    if (prior !== null) pts.unshift({ t: from, v: prior });
    if (now !== null) pts.push({ t: end, v: now });
    if (pts.length < 2 || pts[pts.length - 1].t - pts[0].t < 60000) return null;
    const vs = pts.map(q => q.v), lo = Math.min(...vs), hi = Math.max(...vs);
    // A flat line says nothing; leave the space out until the MMR moves.
    if (hi === lo) return null;
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
  function rankRows(list, ranks, hist, compact) {
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
      const sp = sparkline(hist, p.key, x.mmr, p.name + " MMR", 360, compact ? 36 : 60);
      const nums = mk("div", "rank-nums");
      const mmr = mk("p", "mmr", x.mmr !== null ? x.mmr.toLocaleString("en-US") : "\u2014");
      mmr.append(mk("span", "unit", "MMR"));
      nums.append(mmr);
      const ch = weekChange(hist, p.key, x.mmr);
      if (ch) nums.append(mk("p", "wk " + (ch > 0 ? "up" : "down"), (ch > 0 ? "+" : "\u2212") + Math.abs(ch) + " this week"));
      if (x.games !== null) nums.append(mk("p", "gm", x.games.toLocaleString("en-US") + " games"));
      li.append(badge, main, nums);
      // The 8-week trend gets the full width: it's the part that shows growth.
      if (sp) { const tr = mk("div", "trend"); tr.append(sp, mk("p", "trend-k", "8 weeks")); li.append(tr); }
      list.append(li);
    }
  }
  function rankStamp(r) { const t = r.pulledAt && r.pulledAt >= (r.ranksAt || "") ? r.pulledAt : r.ranksAt; return t ? "Updated " + fmtStamp(t) : ""; }
  function renderRanks() {
    if (!S.me) return;
    rankRows($("#rankList"), S.me.ranks, S.myHist);
    $("#rankUpdated").textContent = rankStamp(S.me.ranks);
    const tr = $("#rankTracker");
    tr.hidden = !S.me.trackerUrl;
    if (S.me.trackerUrl) tr.href = S.me.trackerUrl;
  }

  /* ---------- Ranks form: coaches for any player, players for themselves ---------- */
  function ranksFormHtml() {
    return PL.map(q => '<fieldset class="ef"><legend>' + q.name + '</legend><div class="ef-grid">' +
      '<label>Rank<select name="' + q.key + '-tier"><option value="">—</option>' + TIERS.map(t => "<option>" + t + "</option>").join("") + "</select></label>" +
      '<label>Division<select name="' + q.key + '-div"><option value="">—</option>' + DIVS.map(t => "<option>" + t + "</option>").join("") + "</select></label>" +
      '<label>MMR<input type="number" min="0" inputmode="numeric" name="' + q.key + '-mmr"></label>' +
      '<label>Games<input type="number" min="0" inputmode="numeric" name="' + q.key + '-games"></label></div></fieldset>').join("");
  }
  function fillRanksForm(f, ranks) {
    for (const q of PL) {
      const x = ranks.playlists[q.key];
      f.elements[q.key + "-tier"].value = x.tier || "";
      f.elements[q.key + "-div"].value = x.div || "";
      f.elements[q.key + "-mmr"].value = x.mmr === null ? "" : String(x.mmr);
      f.elements[q.key + "-games"].value = x.games === null ? "" : String(x.games);
    }
  }
  function readRanksForm(f) {
    const ranks = {};
    for (const q of PL) ranks[q.key] = { tier: f.elements[q.key + "-tier"].value || null, div: f.elements[q.key + "-div"].value || null, mmr: numOrNull(f.elements[q.key + "-mmr"].value), games: numOrNull(f.elements[q.key + "-games"].value) };
    return ranks;
  }
  function openRankForm() {
    const f = $("#rankForm");
    if (!f.dataset.built) {
      f.dataset.built = "1";
      f.insertAdjacentHTML("afterbegin", '<h3>Update my ranks</h3><p class="fine">Use what the game or your tracker shows right now. MMR and games are optional.</p>' + ranksFormHtml());
    }
    fillRanksForm(f, S.me.ranks);
    setStatus($("#rankStatus"), "");
    f.hidden = false;
    $("#rankEdit").hidden = true;
    const first = f.querySelector("select");
    if (first) first.focus();
  }
  function closeRankForm() { $("#rankForm").hidden = true; $("#rankEdit").hidden = false; }
  $("#rankEdit").addEventListener("click", openRankForm);
  $("#rankCancel").addEventListener("click", closeRankForm);
  $("#rankForm").addEventListener("submit", async e => {
    e.preventDefault();
    const go = $("#rankSave"), st = $("#rankStatus");
    go.disabled = true;
    try {
      const r = await api("PUT", "ranks", { ranks: readRanksForm(e.target) });
      S.me.ranks = normUser(r.me).ranks;
      try { const h = await api("GET", "ranks/history"); S.myHist = normHist(h.history); } catch (_) {}
      closeRankForm();
      renderRanks(); renderToday();
      setStatus($("#rankSaved"), "Ranks saved.", "ok");
    } catch (err) { setStatus(st, err.message, "err"); }
    finally { go.disabled = false; }
  });

  /* ---------- Coach: data ---------- */
  let coachLoading = false;
  async function loadCoach() {
    if (!S.me || S.me.role !== "coach" || coachLoading) return;
    coachLoading = true;
    const wk = S.coachWk;
    try {
      const [p, w, rv, ev] = await Promise.all([api("GET", "coach/players"), api("GET", "coach/weeks/" + wk), api("GET", "coach/reviews").catch(() => null), feat("schedule") ? api("GET", "coach/events").catch(() => null) : null]);
      if (rv) S.reviews = (rv.reviews || []).map(normReview);
      if (ev) { S.cEvents = (ev.events || []).map(normEvent); S.series = (ev.series || []).map(normSeries); }
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
    // Roster counts in Settings come from the roster that just loaded.
    if (draft && !$("#rosterEd").contains(document.activeElement)) renderRosterEd();
    if (S.sel) { loadHist(S.sel); loadPast(S.sel); }
  }
  async function loadPast(id) {
    try {
      const r = await api("GET", "coach/players/" + id + "/weeks"), m = {};
      for (const x of r.weeks || []) if (/^\d{4}-\d{2}-\d{2}$/.test(x.week)) m[x.week] = normWeek(x.data, x.week);
      S.pweeks[id] = m;
    } catch (_) { return; }
    if (S.sel === id) renderPlayerDetail();
  }
  async function loadHist(id) {
    try { const r = await api("GET", "coach/players/" + id + "/history"); S.hist[id] = normHist(r.history); }
    catch (_) { return; }
    if (S.sel === id) renderPlayerDetail();
  }
  function rosterIds() {
    // Everyone on a roster (coaches who play too), plus other coaches only in weeks they logged something.
    return Object.keys(S.roster).filter(id => plays(S.roster[id]) || (!!S.rosterWeeks[id] && S.rosterWeeks[id].sessions.length > 0));
  }
  // Status for the viewed week. Same requirement for everyone except Casual players, who have none.
  function playerStatus(id) {
    const p = S.roster[id], w = S.rosterWeeks[id] || normWeek(null, S.coachWk), wk = S.coachWk, thisWk = mondayOf(S.today);
    const st = weekStats(w, p), rows = reqRows(st, p, wk), left = remaining(rows);
    const isNew = playsFrom(p) && ymd(new Date(playsFrom(p))) > addDays(wk, 6);
    // No requirement: a roster with no set sessions, or a coach who logs training but doesn't play.
    if (freeTeam(p.team) || !plays(p)) return { g: p.active && wk === thisWk ? "live" : isNew ? "notyet" : "free", left: 0, st };
    let g = "open";
    if (p.active && wk === thisWk) g = "live";
    else if (rows.length && !left) g = "done";
    else if (isNew) g = "notyet";
    else if (wk < thisWk) g = "missed";
    return { g, left, st };
  }
  const STATUS_RANK = { live: 0, open: 1, missed: 1, done: 2, free: 2, notyet: 3 };
  function statusLabel(x) {
    if (x.g === "live") return "In session";
    if (x.g === "done") return "Done";
    if (x.g === "missed") return "Missed";
    if (x.g === "notyet") return "New";
    if (x.g === "free") { const n = x.st.ranked + x.st.training; return n + (n === 1 ? " session" : " sessions"); }
    return x.left + " left";
  }

  /* ---------- Coach: render ---------- */
  function pickPlayer(id) {
    S.sel = id; renderCoach(); loadHist(id); loadPast(id);
    if (matchMedia("(max-width: 979px)").matches) $("#winPlayer").scrollIntoView({ block: "start" });
  }
  function renderCoach() {
    if (!S.me || S.me.role !== "coach") return;
    const thisWk = mondayOf(S.today);
    $("#cwLabel").textContent = weekLabel(S.coachWk);
    $("#cwThis").hidden = S.coachWk === thisWk;
    const ids = rosterIds();
    // Who needs attention, at a glance: still to go, in session, done, and replay reviews waiting.
    const att = $("#attn");
    att.textContent = "";
    if (S.rosterLoaded && ids.length) {
      const sts = ids.filter(id => plays(S.roster[id])).map(playerStatus), n = g => sts.filter(x => x.g === g).length;
      const item = (num, label, cls) => { const p = mk("p", "attn-i" + (cls ? " " + cls : "")); p.append(mk("b", "", String(num)), document.createTextNode(" " + label)); att.append(p); };
      if (S.coachWk === thisWk) {
        if (n("live")) item(n("live"), "in session", "live");
        item(n("open"), "still to go", n("open") ? "todo" : "");
        item(n("done"), "done");
      } else { item(n("missed"), "missed", n("missed") ? "todo" : ""); item(n("done"), "done"); }
      const rv = feat("reviews") ? S.reviews.filter(r => r.status === "open").length : 0;
      if (rv) { const b = mk("button", "attn-i link"); b.type = "button"; b.dataset.go = "reviews"; b.append(mk("b", "", String(rv)), document.createTextNode(rv === 1 ? " replay review waiting" : " replay reviews waiting")); att.append(b); }
    }
    $("#rosterEmpty").hidden = !S.rosterLoaded || ids.length > 0;
    const box = $("#rosterList");
    box.hidden = !ids.length;
    box.textContent = "";
    if (ids.length) {
      const head = mk("div", "rrow rh");
      head.append(mk("span", "", "Player"), mk("span", "", "Ranked"), mk("span", "", "Training"), mk("span", "", "Status"));
      box.append(head);
    }
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
      if (p.role === "coach") nm.append(mk("span", "bteam brole", "Coach"));
      const pill = mk("span", "pill " + x.g, statusLabel(x));
      if (x.g === "live") pill.title = TYPES[p.active.type].label + " \u00b7 " + fmtDur(elapsedMin(p.active.startedAt));
      const PT = plays(p) ? targetsFor(p, S.coachWk) : { ranked: 0, training: 0 };
      b.append(nm, cell(x.st.ranked, PT.ranked), cell(x.st.training, PT.training), pill);
      b.addEventListener("click", () => pickPlayer(x.id));
      box.append(b);
    }
    // Coach accounts, listed under the players (the admin manages them from here).
    const coaches = Object.keys(S.roster).filter(id => S.roster[id].role === "coach")
      .sort((x, y) => S.roster[x].name.localeCompare(S.roster[y].name, "en", { sensitivity: "base" }));
    $("#coachBox").hidden = !S.rosterLoaded || !coaches.length;
    const cl = $("#coachList");
    cl.textContent = "";
    for (const id of coaches) {
      const b = mk("button", "rrow crow");
      b.type = "button";
      if (S.sel === id) b.setAttribute("aria-current", "true");
      const nm = mk("span", "rname", S.roster[id].name);
      if (id === S.me.id) nm.append(mk("span", "bteam", "You"));
      if (S.roster[id].team) nm.append(mk("span", "bteam", "Plays on " + teamName(S.roster[id].team)));
      b.append(nm);
      b.addEventListener("click", () => pickPlayer(id));
      cl.append(b);
    }
    renderPlayerDetail();
    renderReviews();
    renderSchedC();
  }

  /* ---------- Coach: replay review requests ---------- */
  function renderReviews() {
    const box = $("#reviewList");
    if (!box) return;
    box.textContent = "";
    const open = S.reviews.filter(r => r.status === "open"), done = S.reviews.filter(r => r.status === "done").slice(0, 5);
    rvBadge();
    if (!open.length) box.append(mk("p", "empty", "No requests waiting."));
    const card = r => {
      const c = mk("div", "rv-card" + (r.status === "done" ? " done" : ""));
      const head = mk("p", "rv-head");
      head.append(mk("b", "", r.name || "Player"), mk("span", "", fmtStamp(new Date(r.createdAt).toISOString())));
      if (r.playlist) head.append(mk("span", "", plName(r.playlist)));
      c.append(head, mk("p", "rv-note", r.note));
      const row = mk("div", "row");
      if (r.link) { const a = mk("a", "linkbtn", "Open replay"); a.href = r.link; a.target = "_blank"; a.rel = "noopener noreferrer"; row.append(a); }
      const go = mk("button", "linkbtn", "Open session"); go.type = "button";
      go.addEventListener("click", () => {
        S.sel = r.userId;
        if (r.week !== S.coachWk) coachWeek(r.week); else renderCoach();
        loadHist(r.userId); loadPast(r.userId);
        showWin("#winPlayer");
      });
      row.append(go);
      const mark = mk("button", "btn sm" + (r.status === "open" ? " primary push" : " push"), r.status === "open" ? "Mark reviewed" : "Reopen"); mark.type = "button";
      mark.addEventListener("click", async () => {
        mark.disabled = true;
        const status = r.status === "open" ? "done" : "open";
        try { await api("PATCH", "coach/reviews/" + r.id, { status }); r.status = status; renderReviews(); }
        catch (err) { mark.disabled = false; }
      });
      const rm = mk("button", "linkbtn rm", "Remove"); rm.type = "button";
      rm.addEventListener("click", () => armOrRun(rm, async () => {
        rm.disabled = true;
        try { await api("DELETE", "coach/reviews/" + r.id); S.reviews = S.reviews.filter(x => x.id !== r.id); renderReviews(); }
        catch (err) { rm.disabled = false; }
      }, "Confirm"));
      row.append(rm, mark);
      c.append(row);
      return c;
    };
    open.forEach(r => box.append(card(r)));
    if (done.length) { box.append(mk("p", "rv-done-h", "Reviewed")); done.forEach(r => box.append(card(r))); }
  }

  function renderPlayerDetail() {
    const body = $("#pdBody"), id = S.sel, p = id ? S.roster[id] : null;
    if (!p) {
      S.pdFor = null;
      $("#tPlayer").textContent = "Player";
      body.textContent = "";
      body.append(mk("p", "empty", "Select a player to see their week, ranks and sessions."));
      $("#winPlayer").classList.add("is-empty");
      return;
    }
    $("#winPlayer").classList.remove("is-empty");
    if (S.pdFor !== id) { buildPlayerDetail(body, id); S.pdFor = id; S.noteOpen = null; S.noteDraft = {}; S.editOpen = null; S.editEl = null; }
    $("#tPlayer").textContent = p.name;
    $("#pdName").textContent = p.name;
    const ts = $("#pdTeam");
    if (ts && document.activeElement !== ts) teamSelect(ts, p.role === "coach", p.team);
    const link = $("#pdTracker");
    link.hidden = !p.trackerUrl;
    if (p.trackerUrl) link.href = p.trackerUrl;
    const stats = $("#pdStats");
    // Keep an open note editor's focus and cursor through the 30-second refresh.
    const fe = document.activeElement, focusNote = fe && fe.dataset && fe.dataset.noteFor ? { sid: fe.dataset.noteFor, a: fe.selectionStart, b: fe.selectionEnd } : null;
    const focusEdit = S.editEl && fe && S.editEl.contains(fe) ? { el: fe, a: fe.selectionStart, b: fe.selectionEnd } : null;
    let editFound = false;
    stats.textContent = "";
    if (p.active && S.coachWk === mondayOf(S.today)) stats.append(mk("p", "status err", "● " + TYPES[p.active.type].label + " · since " + fmtClock(p.active.startedAt)));
    const w = S.rosterWeeks[id] || normWeek(null, S.coachWk);
    const st = weekStats(w, p);
    if (feat("ranks")) {
      const ranks = mk("ul", "rank-list");
      rankRows(ranks, p.ranks, S.hist[id] || [], true);
      stats.append(ranks);
      const stamp = rankStamp(p.ranks);
      if (stamp) stats.append(mk("p", "fine", stamp));
      if (!p.trackerUrl) stats.append(mk("p", "fine", "No tracker link"));
    }
    const rows = reqRows(st, p, S.coachWk);
    const reqs = mk("div", "reqs");
    renderReqs(reqs, rows);
    stats.append(reqs);
    if (targetsFor(p, S.coachWk).custom) stats.append(mk("p", "fine", "Own requirement this week"));
    for (const d of weekDates(S.coachWk)) {
      const ses = w.sessions.filter(s => s.date === d).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      if (!ses.length) continue;
      const dayBox = mk("div", "pd-day");
      dayBox.append(mk("h4", "", fmtDate(d, { weekday: "long", month: "short", day: "numeric" })));
      for (const s of ses) {
        const ok = counts(s, p);
        const sb = mk("div", "pd-sess" + (s.endedAt ? (ok ? "" : " nc") : " live"));
        sb.append(mk("p", "pd-line", (s.endedAt ? (ok ? "✓ " : "– ") : "● ") + TYPES[s.type].label + " · " + (s.endedAt ? fmtClock(s.startedAt) + "–" + fmtClock(s.endedAt) + " · " + fmtDur(s.minutes) + (s.edited ? " · edited" : "") + (s.coachEditedAt ? " · coach edited" : "") : "since " + fmtClock(s.startedAt))));
        if (s.endedAt && S.editOpen === s.id) {
          // The open editor keeps its own form across the 30-second refresh.
          editFound = true;
          if (!S.editEl || S.editEl.dataset.sid !== s.id || S.editEl.dataset.wk !== S.coachWk) S.editEl = buildEditForm(id, S.coachWk, s);
          sb.append(S.editEl);
          dayBox.append(sb);
          continue;
        }
        const sum = sessionSummary(s);
        if (sum) sb.append(mk("p", "pd-line muted", sum));
        if (s.endedAt && !ok) sb.append(mk("p", "nc", "Doesn't count: " + shortReason(s, p)));
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
    const past = mk("div", "past-box");
    if (S.pweeks[id]) renderPast(past, p, w2 => S.pweeks[id][w2] || normWeek(null, w2), w2 => coachWeek(w2), S.coachWk);
    stats.append(past);
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
    // Coach accounts are handled by the Backpost admin: password, remove, coach or player.
    const admin = !!(S.me && S.me.admin);
    if (p.role === "player" || admin) btn("Password", "", () => {
      const f = form("New password", '<label class="fld"><span class="sr">New password</span><span class="pw-row"><input type="text" name="pw" maxlength="128" autocomplete="off" spellcheck="false"><button type="button" class="btn sm" data-gen>New</button></span></label>' + (S.roster[id].role === "coach" ? '<p class="fine">They\'re signed out everywhere and use this password next time.</p>' : ""), "Set password", async f2 => {
        const pw = f2.elements.pw.value;
        if (await patch({ password: pw }, "")) showCopy(status, S.roster[id].name, pw);
      });
      f.elements.pw.value = genPassword();
      f.querySelector("[data-gen]").addEventListener("click", () => { f.elements.pw.value = genPassword(); });
    });
    if (plays(p)) btn("Requirement", "", () => {
      const cur = S.roster[id], T = targetsFor(cur, mondayOf(S.today));
      const inner = freeTeam(cur.team)
        ? '<p class="fine">' + teamName(cur.team) + ' has no set sessions. Move this player to another roster to give them a requirement.</p>'
        : '<div class="ef-grid"><label>Ranked Sessions<input type="number" name="rq-ranked" min="0" max="14" step="1"></label><label>Training sessions<input type="number" name="rq-training" min="0" max="14" step="1"></label></div>' +
          '<p class="fine">Applies from this week on. Past weeks keep theirs.</p><div class="row"><button type="button" class="linkbtn" data-team>Use the team requirement</button></div>';
      const f = form("Weekly requirement", inner, "Save", async f2 => {
        if (freeTeam(S.roster[id].team)) return;
        const v = n => { const x = f2.elements.namedItem(n).value.trim(); return x === "" ? null : Math.min(14, n0(x)); };
        await patch({ targets: { ranked: v("rq-ranked"), training: v("rq-training") }, from: mondayOf(S.today) }, "Requirement saved.");
      });
      if (!freeTeam(cur.team)) {
        f.elements.namedItem("rq-ranked").value = String(T.ranked);
        f.elements.namedItem("rq-training").value = String(T.training);
        f.querySelector("[data-team]").addEventListener("click", () => patch({ targets: { ranked: null, training: null }, from: mondayOf(S.today) }, "Back on the team requirement."));
      }
    });
    btn("Ranks", "", () => {
      const f = form("Ranks", ranksFormHtml(), "Save", async f2 => {
        if (await patch({ ranks: readRanksForm(f2) }, "Ranks saved.")) loadHist(id);
      });
      fillRanksForm(f, S.roster[id].ranks);
    });
    if (admin) btn(p.role === "coach" ? "Make player" : "Make coach", "", () => {
      const toCoach = S.roster[id].role !== "coach";
      const f = form(toCoach ? "Make coach" : "Make player",
        '<p class="fine">' + (toCoach ? S.roster[id].name + " gets the coach view: roster, schedule, reviews and settings. They keep playing on " + teamName(S.roster[id].team) + " until you change Plays on." : S.roster[id].name + " loses the coach view and plays on a roster.") + "</p>" +
        (toCoach ? "" : '<label class="fld"><span class="lbl">Roster</span><select name="prole-team"></select></label>'),
        toCoach ? "Make coach" : "Make player", async f2 => {
          const ok = await patch(toCoach ? { role: "coach" } : { role: "player", team: f2.elements.namedItem("prole-team").value }, toCoach ? "Now a coach." : "Now a player.");
          if (ok) { S.pdFor = null; renderCoach(); setStatus($("#pdStatus"), toCoach ? "Now a coach." : "Now a player.", "ok"); }
        });
      if (!toCoach) { const sel = f.elements.namedItem("prole-team"); rosterList().forEach(r => sel.append(new Option(r.name, r.id))); sel.value = S.roster[id].team || (rosterList().find(r => !r.casual) || rosterList()[0]).id; }
    });
    if (p.role === "player" || admin) {
      const rm = btn("Remove", "danger push", () => {
        closeAll(); setStatus(status, "");
        const box = mk("div", "warnbox");
        box.append(mk("p", "", "Remove " + S.roster[id].name + (S.roster[id].role === "coach" ? "'s coach account?" : " and all their data?")));
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
      rm.setAttribute("aria-label", p.role === "coach" ? "Remove coach" : "Remove player");
    }
    {
      // Players are always on a roster. A coach can play on one too, or not play.
      const coach = p.role === "coach";
      const tr = mk("label", "pd-team");
      tr.append(mk("span", "lbl", coach ? "Plays on" : "Roster"));
      const sel = mk("select");
      sel.id = "pdTeam";
      teamSelect(sel, coach, p.team);
      sel.addEventListener("change", async () => {
        const was = plays(S.roster[id]), msg = sel.value ? (coach ? "Plays on " + teamName(sel.value) + " now." : "Moved to " + teamName(sel.value) + ".") : "Off the roster. Still a coach.";
        if (!(await patch({ team: sel.value || null }, msg))) { sel.value = S.roster[id].team || ""; return; }
        if (id === S.me.id) { S.me.team = S.roster[id].team; refresh(); }
        // Starting or stopping play changes what's in this panel (the requirement).
        if (was !== plays(S.roster[id])) { S.pdFor = null; renderCoach(); setStatus($("#pdStatus"), msg, "ok"); }
      });
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
      try { await navigator.clipboard.writeText("Name: " + name + "\nPassword: " + pw + "\n" + location.origin + (ROUTE.base === "/" ? "" : ROUTE.base)); b.textContent = "Copied"; }
      catch (_) { const r = document.createRange(); r.selectNodeContents(code); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    });
    box.append(code, b);
    statusEl.append(box);
  }

  // Add player
  $("#addOpen").addEventListener("click", () => {
    const f = $("#addForm");
    f.hidden = !f.hidden;
    if (!f.hidden) {
      // Only the Backpost admin can add a coach account here.
      $("#addRoleRow").hidden = !S.me.admin; $("#addRole").value = "player";
      addTeamFor();
      $("#addPw").value = genPassword(); setStatus($("#addStatus"), ""); $("#addName").focus();
    }
  });
  // A new player goes on the first roster with set sessions; a new coach doesn't play unless picked.
  function addTeamFor() {
    const coach = $("#addRole").value === "coach";
    $("#addTeamLbl").textContent = coach ? "Plays on" : "Roster";
    teamSelect($("#addTeam"), coach, coach ? "" : (rosterList().find(r => !r.casual) || rosterList()[0]).id);
  }
  const addPwFor = () => genPassword() + ($("#addRole").value === "coach" ? genPassword().slice(0, 4) : "");
  $("#addRole").addEventListener("change", () => { addTeamFor(); $("#addPw").value = addPwFor(); });
  $("#addGen").addEventListener("click", () => { $("#addPw").value = addPwFor(); });
  $("#addCancel").addEventListener("click", () => { $("#addForm").hidden = true; });
  $("#addForm").addEventListener("submit", async e => {
    e.preventDefault();
    const st = $("#addStatus");
    const name = $("#addName").value.trim(), pw = $("#addPw").value, tracker = $("#addTracker").value.trim(), team = $("#addTeam").value;
    const role = S.me.admin && $("#addRole").value === "coach" ? "coach" : "player";
    if (!name) { setStatus(st, "Enter a name.", "err"); return; }
    try {
      const r = await api("POST", "coach/players", Object.assign({ name, password: pw, trackerUrl: tracker, team: team || null }, role === "coach" ? { role } : {}));
      const u = normUser(r.player);
      S.roster[u.id] = u;
      showCopy(st, u.name, pw);
      $("#addName").value = ""; $("#addTracker").value = ""; $("#addPw").value = addPwFor();
      $("#addName").focus();
      renderCoach();
    } catch (err) { setStatus(st, err.message, "err"); }
  });

  // Coach week nav
  const coachWeek = wk => { S.coachWk = wk; S.rosterWeeks = {}; renderCoach(); loadCoach(); };
  $("#cwPrev").addEventListener("click", () => coachWeek(addDays(S.coachWk, -7)));
  $("#cwNext").addEventListener("click", () => coachWeek(addDays(S.coachWk, 7)));
  $("#cwThis").addEventListener("click", () => coachWeek(mondayOf(S.today)));

  /* ---------- Settings: Team, Look, Rosters, Requirements ---------- */
  (function buildGoalGrid() {
    const g = $("#goalGrid");
    for (const p of PL) g.insertAdjacentHTML("beforeend",
      '<label for="g-' + p.key + '-min">' + p.short + ' min<input type="number" id="g-' + p.key + '-min" min="0" max="60" step="1"></label>' +
      '<label for="g-' + p.key + '-max">' + p.short + ' max<input type="number" id="g-' + p.key + '-max" min="0" max="60" step="1"></label>');
  })();
  const TZS = [["America/New_York", "Eastern"], ["America/Chicago", "Central"], ["America/Denver", "Mountain"], ["America/Phoenix", "Arizona"], ["America/Los_Angeles", "Pacific"], ["America/Anchorage", "Alaska"], ["Pacific/Honolulu", "Hawaii"]];
  let draft = null, rosterKeys = 0;
  function setTab(tab) {
    document.querySelectorAll("#settingsForm .seg-b").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    document.querySelectorAll("#settingsForm .tabp").forEach(p => { p.hidden = p.dataset.panel !== tab; });
  }
  document.querySelectorAll("#settingsForm .seg-b").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
  function markDirty() { S.settingsDirty = true; $("#setRevert").hidden = false; setStatus($("#setStatus"), ""); }
  function renderSettingsForm(force) {
    if (!S.me || S.me.role !== "coach" || (S.settingsDirty && !force)) return;
    draft = clone(S.settings);
    draft.rosters.forEach(r => { r.key = "k" + (++rosterKeys); });
    fillSettings();
  }
  function fillSettings() {
    const s = draft;
    setVal($("#setTitle"), s.title);
    const tz = $("#setTz"), zones = TZS.slice();
    if (!zones.some(z => z[0] === s.tz)) zones.push([s.tz, s.tz.replace(/_/g, " ")]);
    if (tz.options.length !== zones.length) { tz.textContent = ""; zones.forEach(([v, l]) => tz.append(new Option(l, v))); }
    tz.value = s.tz;
    document.querySelectorAll("#featBox [data-feat]").forEach(c => { c.checked = s.features[c.dataset.feat] !== false; });
    renderSchedRosterBox();
    // Look
    paintLogo($("#setLogoImg"), $("#setMono"), s);
    $("#setLogoRm").hidden = !s.logo || !/^\/api\//.test(s.logo);
    setVal($("#setPrimary"), s.theme.primary); setVal($("#setPrimaryHex"), s.theme.primary);
    const sec = s.theme.secondary;
    $("#setNoSecondary").checked = !sec;
    $("#setSecondary").disabled = $("#setSecondaryHex").disabled = !sec;
    setVal($("#setSecondary"), sec || "#ed8727"); setVal($("#setSecondaryHex"), sec || "");
    for (const k of ["paper", "fonts", "shape", "header"]) document.querySelectorAll('#settingsForm input[name="' + k + '"]').forEach(r => { r.checked = r.value === s.theme[k]; });
    $("#lookNote").hidden = !S.lookPreview;
    // Rosters
    renderRosterEd();
    // Requirements
    setVal($("#setRanked"), String(s.targets.ranked));
    setVal($("#setTraining"), String(s.targets.training));
    setVal($("#setMinGames"), String(s.targets.minGames));
    setVal($("#setMinMinutes"), String(s.targets.minMinutes));
    for (const p of PL) {
      const g = s.rankedGoals[p.key];
      setVal($("#g-" + p.key + "-min"), g.min === null ? "" : String(g.min));
      setVal($("#g-" + p.key + "-max"), g.max === null ? "" : String(g.max));
    }
    $("#setRevert").hidden = !S.settingsDirty;
  }
  function renderSchedRosterBox() {
    const box = $("#schedRosterBox");
    box.textContent = "";
    for (const r of draft.rosters) {
      if (!r.id) continue;
      const l = mk("label", "chk"), c = mk("input");
      c.type = "checkbox"; c.checked = draft.schedRosters.includes(r.id);
      c.addEventListener("change", () => { draft.schedRosters = draft.rosters.filter(x => x.id && (x.id === r.id ? c.checked : draft.schedRosters.includes(x.id))).map(x => x.id); markDirty(); });
      l.append(c, document.createTextNode(" " + r.name));
      box.append(l);
    }
    if (!box.children.length) box.append(mk("p", "fine", "Save your rosters first."));
  }
  function renderRosterEd() {
    const box = $("#rosterEd");
    const fe = document.activeElement, keep = fe && fe.dataset && fe.dataset.rk ? { k: fe.dataset.rk, a: fe.selectionStart } : null;
    box.textContent = "";
    const counts = {};
    for (const id of Object.keys(S.roster)) { const t = S.roster[id].team; if (t) counts[t] = (counts[t] || 0) + 1; }
    for (const r of draft.rosters) {
      const row = mk("div", "rost-row");
      const name = mk("input"); name.type = "text"; name.maxLength = 20; name.value = r.name; name.dataset.rk = r.key;
      name.setAttribute("aria-label", "Roster name");
      name.addEventListener("input", () => { r.name = name.value; markDirty(); });
      const cas = mk("label", "chk"), cb = mk("input");
      cb.type = "checkbox"; cb.checked = r.casual;
      cb.addEventListener("change", () => { r.casual = cb.checked; markDirty(); });
      cas.append(cb, document.createTextNode(" No set sessions"));
      const n = r.id ? counts[r.id] || 0 : 0;
      const info = mk("span", "fine", n === 1 ? "1 player" : n + " players");
      const rm = mk("button", "linkbtn rm", "Remove"); rm.type = "button";
      rm.disabled = n > 0 || draft.rosters.length < 2;
      rm.title = n > 0 ? "Move these players to another roster first" : "";
      rm.addEventListener("click", () => { draft.rosters = draft.rosters.filter(x => x !== r); draft.schedRosters = draft.schedRosters.filter(x => x !== r.id); markDirty(); renderRosterEd(); renderSchedRosterBox(); });
      row.append(name, cas, info, rm);
      box.append(row);
    }
    $("#rosterAdd").disabled = draft.rosters.length >= 8;
    if (keep) { const t = box.querySelector('[data-rk="' + keep.k + '"]'); if (t) { t.focus(); try { t.setSelectionRange(keep.a, keep.a); } catch (_) {} } }
  }
  $("#rosterAdd").addEventListener("click", () => {
    if (draft.rosters.length >= 8) return;
    draft.rosters.push({ name: "New roster", casual: false, key: "k" + (++rosterKeys) });
    markDirty(); renderRosterEd();
    const inputs = $("#rosterEd").querySelectorAll("input[type=text]"); const last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.select(); }
  });
  // Look changes show right away as a preview; they're kept only when saved.
  function previewLook() { S.lookPreview = true; applyTheme(draft, true); paintLogo($("#schoolLogo"), $("#monoLogo"), draft); $("#lookNote").hidden = false; }
  const hexOk = v => /^#[0-9a-f]{6}$/i.test(v);
  $("#settingsForm").addEventListener("input", e => {
    const t = e.target;
    if (!draft) return;
    if (t.id === "setTitle") draft.title = t.value;
    else if (t.id === "setPrimary" || t.id === "setPrimaryHex") { const v = t.value.trim(); if (hexOk(v)) { draft.theme.primary = v.toLowerCase(); setVal($(t.id === "setPrimary" ? "#setPrimaryHex" : "#setPrimary"), draft.theme.primary); previewLook(); } }
    else if (t.id === "setSecondary" || t.id === "setSecondaryHex") { const v = t.value.trim(); if (hexOk(v)) { draft.theme.secondary = v.toLowerCase(); setVal($(t.id === "setSecondary" ? "#setSecondaryHex" : "#setSecondary"), draft.theme.secondary); previewLook(); } }
    else if (t.closest(".set-grid")) { /* read on save */ }
    else return;
    markDirty();
  });
  $("#settingsForm").addEventListener("change", e => {
    const t = e.target;
    if (!draft) return;
    if (t.id === "setTz") draft.tz = t.value;
    else if (t.dataset.feat) draft.features[t.dataset.feat] = t.checked;
    else if (t.id === "setNoSecondary") { draft.theme.secondary = t.checked ? "" : ($("#setSecondary").value || "#ed8727"); $("#setSecondary").disabled = $("#setSecondaryHex").disabled = t.checked; setVal($("#setSecondaryHex"), draft.theme.secondary); previewLook(); }
    else if (["paper", "fonts", "shape", "header"].includes(t.name)) { draft.theme[t.name] = t.value; previewLook(); }
    else return;
    markDirty();
  });
  $("#setRevert").addEventListener("click", () => {
    S.settingsDirty = false; S.lookPreview = false;
    applyTheme(S.settings); renderHeader();
    renderSettingsForm(true);
    setStatus($("#setStatus"), "");
  });
  $("#settingsForm").addEventListener("submit", async e => {
    e.preventDefault();
    const goals = {};
    for (const p of PL) goals[p.key] = { min: $("#g-" + p.key + "-min").value, max: $("#g-" + p.key + "-max").value };
    const out = clone(draft);
    out.title = $("#setTitle").value.trim();
    out.targets = { ranked: $("#setRanked").value, training: $("#setTraining").value, minGames: $("#setMinGames").value, minMinutes: $("#setMinMinutes").value };
    out.rankedGoals = goals;
    out.rosters = draft.rosters.map(r => (r.id ? { id: r.id, name: r.name, casual: r.casual } : { name: r.name, casual: r.casual }));
    if (out.rosters.some(r => !r.name.trim())) { setTab("rosters"); setStatus($("#setStatus"), "Give every roster a name.", "err"); return; }
    try {
      const r = await api("PUT", "coach/settings", { settings: out, from: mondayOf(S.today) });
      S.settings = normSettings(r.settings);
      S.settingsDirty = false; S.lookPreview = false;
      renderSettingsForm(true);
      setStatus($("#setStatus"), "Saved.", "ok");
      renderAll();
    } catch (err) { setStatus($("#setStatus"), err.message, "err"); }
  });
  /* Logo upload: made into a PNG in the browser (any SVG or photo becomes plain pixels), plus a 512 x 512 app icon. */
  async function loadImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
  }
  function trimmed(img) {
    const w = img.naturalWidth || 512, h = img.naturalHeight || 512, k = Math.min(1, 1024 / Math.max(w, h));
    const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
    const g = c.getContext("2d"); g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return c;
    const out = document.createElement("canvas"); out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext("2d").drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }
  function fitPng(src, box, bg, pad) {
    const c = document.createElement("canvas");
    const k = Math.min((box * (1 - 2 * pad)) / src.width, (box * (1 - 2 * pad)) / src.height, bg ? 99 : 1);
    if (bg) { c.width = c.height = box; const g = c.getContext("2d"); g.fillStyle = bg; g.fillRect(0, 0, box, box); g.drawImage(src, (box - src.width * k) / 2, (box - src.height * k) / 2, src.width * k, src.height * k); }
    else { c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k)); c.getContext("2d").drawImage(src, 0, 0, c.width, c.height); }
    return c.toDataURL("image/png").split(",")[1];
  }
  $("#setLogoFile").addEventListener("change", async e => {
    const file = e.target.files && e.target.files[0], st = $("#setStatus");
    e.target.value = "";
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setStatus(st, "That file is too big. Use one under 8 MB.", "err"); return; }
    setStatus(st, "Uploading logo…");
    try {
      const art = trimmed(await loadImage(file));
      let logo = fitPng(art, 512, null, 0);
      if (logo.length > 540000) logo = fitPng(art, 320, null, 0);
      const bg = $("#setIconBg").value === "white" ? "#ffffff" : draft.theme.primary;
      const icon = fitPng(art, 512, bg, 0.18);
      const r = await api("PUT", "coach/asset", { logo, icon });
      const fresh = normSettings(r.settings);
      S.settings.logo = draft.logo = fresh.logo; S.settings.icon = draft.icon = fresh.icon;
      renderHeader(); fillSettings();
      setStatus(st, "Logo saved.", "ok");
    } catch (err) { setStatus(st, err.message || "That image couldn't be read. Try a PNG.", "err"); }
  });
  $("#setLogoRm").addEventListener("click", async () => {
    try {
      const r = await api("DELETE", "coach/asset");
      const fresh = normSettings(r.settings);
      S.settings.logo = draft.logo = fresh.logo; S.settings.icon = draft.icon = fresh.icon;
      renderHeader(); fillSettings();
      setStatus($("#setStatus"), "Logo removed.", "ok");
    } catch (err) { setStatus($("#setStatus"), err.message, "err"); }
  });

  /* ---------- Schedule: matches, scrims and film sessions ---------- */
  const EV_KIND = { match: "Match", scrim: "Scrim", film: "Film session" };
  const RSVP_L = { in: "In", maybe: "Maybe", out: "Out" };
  function normEvent(e) {
    return {
      id: String(e.id), kind: EV_KIND[e.kind] ? e.kind : "scrim", opponent: str(e.opponent, 60), startsAt: str(e.startsAt, 40), format: str(e.format, 40),
      details: str(e.details, 1000), link: /^https?:\/\//i.test(e.link || "") ? str(e.link, 300) : "", teams: Array.isArray(e.teams) ? e.teams.filter(x => typeof x === "string") : [],
      result: str(e.result, 40), reviews: Array.isArray(e.reviews) ? e.reviews.filter(x => typeof x === "string") : [],
      rsvps: Array.isArray(e.rsvps) ? e.rsvps.filter(isPlain).map(r => ({ userId: String(r.userId), name: str(r.name, 32), status: RSVP_L[r.status] ? r.status : "" })) : [],
      mine: RSVP_L[e.mine] ? e.mine : "", series: typeof e.series === "string" ? e.series : null, own: e.own === true
    };
  }
  // A weekly event: the same event on the picked days every week.
  const DAY_L = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], WEEK_DAYS = [1, 2, 3, 4, 5, 6, 0];
  function normSeries(s) {
    return {
      id: String(s.id), kind: EV_KIND[s.kind] ? s.kind : "scrim", opponent: str(s.opponent, 60),
      days: Array.isArray(s.days) ? WEEK_DAYS.filter(d => s.days.includes(d)) : [], time: /^\d{2}:\d{2}$/.test(s.time) ? s.time : "19:00",
      startsOn: /^\d{4}-\d{2}-\d{2}$/.test(s.startsOn) ? s.startsOn : S.today, until: /^\d{4}-\d{2}-\d{2}$/.test(s.until || "") ? s.until : null,
      format: str(s.format, 40), details: str(s.details, 1000), link: /^https?:\/\//i.test(s.link || "") ? str(s.link, 300) : "",
      teams: Array.isArray(s.teams) ? s.teams.filter(x => typeof x === "string") : []
    };
  }
  function daysText(days) { const n = WEEK_DAYS.filter(d => days.includes(d)).map(d => DAY_L[d]); return n.length < 2 ? n.join("") : n.slice(0, -1).join(", ") + " and " + n[n.length - 1]; }
  function hmText(hm) { const [h, m] = hm.split(":").map(Number); const d = new Date(2000, 0, 1, h, m); return fmtClock(d.toISOString()); }
  const evTitle = e => e.kind === "film" ? e.opponent : "vs " + e.opponent;
  const evMs = e => new Date(e.startsAt).getTime();
  function dayTag(d) {
    const t = S.today;
    return d === t ? "Today" : d === addDays(t, 1) ? "Tomorrow" : "";
  }
  function evItem(e, coach) {
    const li = mk("li", "ev ev-" + e.kind + (evMs(e) < Date.now() - 3 * 3600e3 ? " past" : ""));
    li.dataset.id = e.id;
    const when = mk("p", "ev-time", fmtClock(e.startsAt));
    const main = mk("div", "ev-main");
    const top = mk("p", "ev-top");
    top.append(mk("span", "ev-kind", EV_KIND[e.kind]), mk("span", "ev-title", evTitle(e)));
    main.append(top);
    const meta = [];
    if (e.series) meta.push("Weekly");
    if (e.format) meta.push(e.format);
    if (coach || e.teams.length > 1) meta.push(e.teams.map(teamName).filter(Boolean).join(", "));
    if (e.result) meta.push("Result: " + e.result);
    if (meta.length) main.append(mk("p", "ev-meta", meta.join(" — ")));
    if (e.details) main.append(mk("p", "ev-details", e.details));
    if (e.kind === "film" && e.reviews.length) {
      const rv = S.reviews.length ? S.reviews : S.myReviews;
      const names = e.reviews.map(id => rv.find(r => r.id === id)).filter(Boolean).map(r => (r.name || S.me.name) + ": " + (r.note.length > 60 ? r.note.slice(0, 59) + "…" : r.note));
      if (names.length) { const ul = mk("ul", "ev-reviews"); names.forEach(n => ul.append(mk("li", "", n))); main.append(ul); }
    }
    if (e.link) { const a = mk("a", "linkbtn", "Open link"); a.href = e.link; a.target = "_blank"; a.rel = "noopener noreferrer"; main.append(a); }
    const tally = { in: [], maybe: [], out: [] };
    e.rsvps.forEach(r => { if (tally[r.status]) tally[r.status].push(r.name); });
    const future = evMs(e) > Date.now() - 6 * 3600e3;
    if (!coach && future) {
      const seg = mk("div", "rsvp");
      seg.setAttribute("role", "group");
      seg.setAttribute("aria-label", "Are you in?");
      for (const k of ["in", "maybe", "out"]) {
        const b = mk("button", "rsvp-b rsvp-" + k, RSVP_L[k]); b.type = "button";
        b.setAttribute("aria-pressed", String(e.mine === k));
        b.addEventListener("click", () => rsvp(e, e.mine === k ? "" : k, b));
        seg.append(b);
      }
      main.append(seg);
    }
    const lines = ["in", "maybe", "out"].filter(k => tally[k].length).map(k => RSVP_L[k] + ": " + tally[k].join(", "));
    if (coach && future) {
      const answered = new Set(e.rsvps.map(r => r.userId));
      const waiting = Object.values(S.roster).filter(p => plays(p) && e.teams.includes(p.team) && S.settings.schedRosters.includes(p.team) && !answered.has(p.id)).map(p => p.name).sort();
      if (waiting.length) lines.push("No answer: " + waiting.join(", "));
    }
    if (lines.length) main.append(mk("p", "ev-who", lines.join("  |  ")));
    if (coach) {
      const row = mk("div", "row");
      const ed = mk("button", "linkbtn", "Edit"); ed.type = "button";
      ed.addEventListener("click", () => { S.evEdit = e.id; renderEvForm(); });
      // One week of a weekly event can be skipped; the rest of the weeks stay.
      const rm = mk("button", "linkbtn rm", e.series ? "Skip this week" : "Delete"); rm.type = "button";
      rm.addEventListener("click", () => armOrRun(rm, async () => {
        rm.disabled = true;
        try { await api("DELETE", "coach/events/" + e.id); S.cEvents = S.cEvents.filter(x => x.id !== e.id); renderSchedC(); }
        catch (err) { rm.disabled = false; }
      }, "Confirm"));
      row.append(ed, rm);
      main.append(row);
    }
    li.append(when, main);
    return li;
  }
  function schedInto(box, list, coach) {
    box.textContent = "";
    const now = Date.now();
    const up = list.filter(e => evMs(e) >= now - 3 * 3600e3).sort((a, b) => evMs(a) - evMs(b));
    const past = list.filter(e => evMs(e) < now - 3 * 3600e3).sort((a, b) => evMs(b) - evMs(a)).slice(0, coach ? 8 : 5);
    if (!up.length) box.append(mk("p", "empty", coach ? "Nothing scheduled. Add a match, scrim or film session." : "Nothing scheduled yet."));
    let day = null, ul = null;
    for (const e of up) {
      const d = ymd(new Date(e.startsAt));
      if (d !== day) {
        day = d;
        const h = mk("h3", "ev-day", fmtDate(d, { weekday: "short", month: "short", day: "numeric" }));
        const tag = dayTag(d);
        if (tag) h.append(mk("span", "ev-tag", tag));
        ul = mk("ul", "ev-list");
        box.append(h, ul);
      }
      ul.append(evItem(e, coach));
    }
    if (past.length) {
      box.append(mk("h3", "ev-day past-h", "Recent"));
      const pl = mk("ul", "ev-list");
      past.forEach(e => pl.append(evItem(e, coach)));
      box.append(pl);
    }
  }
  function renderSched() { if (S.me && feat("schedule") && S.schedAccess) schedInto($("#schedList"), S.events, false); }
  function renderSchedC() {
    if (!S.me || S.me.role !== "coach" || !feat("schedule")) return;
    // A form that's open keeps its place through the 30-second refresh.
    schedInto($("#schedListC"), S.cEvents, true);
    renderSeries();
  }
  // Weekly events, each with what it is, when, and who it's for.
  function renderSeries() {
    const box = $("#seriesList");
    $("#seriesBox").hidden = !S.series.length;
    box.textContent = "";
    for (const s of S.series) {
      const li = mk("li", "wk-ev ev-" + s.kind);
      li.dataset.id = s.id;
      const top = mk("p", "ev-top");
      top.append(mk("span", "ev-kind", EV_KIND[s.kind]), mk("span", "ev-title", evTitle(s)));
      const when = "Every " + daysText(s.days) + " at " + hmText(s.time);
      const meta = [s.teams.map(teamName).filter(Boolean).join(", ")];
      if (s.startsOn > S.today) meta.push("Starts " + fmtDate(s.startsOn, { month: "short", day: "numeric" }));
      if (s.until) meta.push("Until " + fmtDate(s.until, { month: "short", day: "numeric" }));
      if (s.format) meta.push(s.format);
      const row = mk("div", "row");
      const ed = mk("button", "linkbtn", "Edit"); ed.type = "button";
      ed.addEventListener("click", () => { S.evEdit = "s:" + s.id; renderEvForm(); });
      const stop = mk("button", "linkbtn rm", "Stop repeating"); stop.type = "button";
      stop.addEventListener("click", () => armOrRun(stop, async () => {
        stop.disabled = true;
        try { await api("DELETE", "coach/series/" + s.id); S.series = S.series.filter(x => x.id !== s.id); await loadCoach(); }
        catch (err) { stop.disabled = false; }
      }, "Remove the upcoming ones?"));
      row.append(ed, stop);
      li.append(top, mk("p", "wk-when", when), mk("p", "ev-meta", meta.join(" — ")), row);
      box.append(li);
    }
  }
  async function rsvp(e, status, btn) {
    btn.disabled = true;
    try {
      await api("PUT", "events/" + e.id + "/rsvp", { status });
      e.mine = status;
      e.rsvps = e.rsvps.filter(r => r.userId !== S.me.id);
      if (status) e.rsvps.push({ userId: S.me.id, name: S.me.name, status });
      renderSched(); renderHomeNext();
    } catch (err) { btn.disabled = false; }
  }
  function localParts(iso) { const d = new Date(iso); return [ymd(d), String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0")]; }
  function renderEvForm() {
    const box = $("#evFormBox");
    box.textContent = "";
    if (!S.evEdit) return;
    // What's open: a new event ("new"), one event (its id), or a weekly event ("s:" + its id).
    const sid = S.evEdit.startsWith("s:") ? S.evEdit.slice(2) : null;
    const sr = sid ? S.series.find(x => x.id === sid) : null;
    const e = S.evEdit === "new" || sid ? null : S.cEvents.find(x => x.id === S.evEdit);
    if ((sid && !sr) || (S.evEdit !== "new" && !sid && !e)) { S.evEdit = null; return; }
    const isNew = S.evEdit === "new", base = sr || e;
    const f = mk("form", "sub ev-form");
    f.noValidate = true;
    const rosters = rosterList();
    f.innerHTML = "<h3>" + (sr ? "Edit weekly event" : e ? "Edit event" : "New event") + "</h3>" +
      (e && e.series ? '<p class="fine ev-one">This changes ' + fmtDate(ymd(new Date(e.startsAt)), { weekday: "long", month: "short", day: "numeric" }) + ' only. To change every week, edit it under Every week.</p>' : "") +
      '<div class="add-grid">' +
      '<label class="fld"><span class="lbl">Type</span><select name="kind"><option value="match">Match</option><option value="scrim">Scrim</option><option value="film">Film session</option></select></label>' +
      '<label class="fld"><span class="lbl ev-opp-l">Opponent</span><input type="text" name="opponent" maxlength="60"></label>' +
      '<label class="fld"><span class="lbl ev-day-l">Day</span><input type="date" name="day"></label>' +
      '<label class="fld"><span class="lbl">Time</span><input type="time" name="time"></label>' +
      (isNew ? '<label class="fld ev-rep"><span class="lbl">Repeats</span><select name="repeat"><option value="">Doesn\'t repeat</option><option value="weekly">Every week</option></select></label>' : "") +
      '<label class="fld ev-until" hidden><span class="lbl">Last day (optional)</span><input type="date" name="until"></label></div>' +
      '<fieldset class="grp ev-days" hidden><legend>On</legend><div class="checks ev-dows"></div></fieldset>' +
      '<div class="add-grid">' +
      '<label class="fld"><span class="lbl">Format (optional)</span><input type="text" name="format" maxlength="40" placeholder="Best of 5"></label>' +
      '<label class="fld"><span class="lbl">Link (optional)</span><input type="url" name="link" maxlength="300" placeholder="Stream, bracket or Discord link"></label></div>' +
      '<fieldset class="grp"><legend>For</legend><div class="checks ev-teams"></div></fieldset>' +
      '<label class="fld"><span class="lbl">Details (optional)</span><textarea name="details" rows="2" maxlength="1000" placeholder="Lobby name and password, where to meet, what to bring"></textarea></label>' +
      '<fieldset class="grp ev-film" hidden><legend>Replay reviews to cover</legend><div class="checks ev-rv"></div></fieldset>' +
      '<label class="fld ev-res"' + (e && evMs(e) < Date.now() ? "" : " hidden") + '><span class="lbl">Result</span><input type="text" name="result" maxlength="40" placeholder="W 3–1"></label>' +
      '<p class="status" role="status"></p><div class="row end"><button type="button" class="btn" data-x>Cancel</button><button type="submit" class="btn primary"></button></div>';
    const F = n => f.elements.namedItem(n);
    const tbox = f.querySelector(".ev-teams");
    for (const r of rosters) {
      const l = mk("label", "chk"), c = mk("input"); c.type = "checkbox"; c.value = r.id;
      c.checked = base ? base.teams.includes(r.id) : !r.casual;
      l.append(c, document.createTextNode(" " + r.name)); tbox.append(l);
    }
    // Days of the week for a weekly event, Monday first.
    const dbox = f.querySelector(".ev-dows");
    for (const d of WEEK_DAYS) {
      const l = mk("label", "chk"), c = mk("input"); c.type = "checkbox"; c.value = String(d);
      c.checked = !!(sr && sr.days.includes(d));
      l.append(c, document.createTextNode(" " + DAY_L[d])); dbox.append(l);
    }
    const rbox = f.querySelector(".ev-rv");
    const openRv = S.reviews.filter(r => r.status === "open" || (e && e.reviews.includes(r.id)));
    for (const r of openRv) {
      const l = mk("label", "chk"), c = mk("input"); c.type = "checkbox"; c.value = r.id; c.checked = !!(e && e.reviews.includes(r.id));
      l.append(c, document.createTextNode(" " + (r.name || "Player") + ": " + (r.note.length > 70 ? r.note.slice(0, 69) + "…" : r.note))); rbox.append(l);
    }
    if (!openRv.length) rbox.append(mk("p", "fine", "No replay review requests waiting."));
    const weekly = () => !!sr || (isNew && F("repeat").value === "weekly");
    const sync = () => {
      const film = F("kind").value === "film", wkly = weekly();
      f.querySelector(".ev-opp-l").textContent = film ? "What you're reviewing" : "Opponent";
      F("opponent").placeholder = film ? "Thursday's scrim vs Kansas State" : "Team name, or TBD";
      // Replay reviews belong to one film session, so a weekly one doesn't list them.
      f.querySelector(".ev-film").hidden = !film || wkly;
      f.querySelector(".ev-days").hidden = !wkly;
      f.querySelector(".ev-until").hidden = !wkly;
      f.querySelector(".ev-day-l").textContent = wkly ? "First day" : "Day";
      f.querySelector('button[type="submit"]').textContent = sr || e ? "Save" : wkly ? "Add weekly event" : "Add event";
      // Starting to repeat: the first day's weekday is picked if nothing is yet.
      if (wkly && !dbox.querySelector("input:checked") && /^\d{4}-\d{2}-\d{2}$/.test(F("day").value)) {
        const c = dbox.querySelector('input[value="' + parseYmd(F("day").value).getDay() + '"]'); if (c) c.checked = true;
      }
    };
    if (e) {
      F("kind").value = e.kind; F("opponent").value = e.opponent;
      const [d, t] = localParts(e.startsAt); F("day").value = d; F("time").value = t;
      F("format").value = e.format; F("link").value = e.link; F("details").value = e.details; F("result").value = e.result;
    } else if (sr) {
      F("kind").value = sr.kind; F("opponent").value = sr.opponent; F("day").value = sr.startsOn; F("time").value = sr.time;
      F("until").value = sr.until || ""; F("format").value = sr.format; F("link").value = sr.link; F("details").value = sr.details;
    } else { F("kind").value = "scrim"; F("day").value = S.today; F("time").value = "19:00"; }
    F("kind").addEventListener("change", sync);
    if (isNew) F("repeat").addEventListener("change", sync);
    sync();
    f.querySelector("[data-x]").addEventListener("click", () => { S.evEdit = null; renderEvForm(); });
    f.addEventListener("submit", async ev => {
      ev.preventDefault();
      const st = f.querySelector(".status"), day = F("day").value, time = F("time").value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{1,2}:\d{2}$/.test(time)) { setStatus(st, "Pick a day and time.", "err"); return; }
      const common = {
        kind: F("kind").value, opponent: F("opponent").value.trim(), format: F("format").value.trim(),
        link: F("link").value.trim(), details: F("details").value.trim(),
        teams: Array.from(tbox.querySelectorAll("input:checked")).map(c => c.value)
      };
      const go = f.querySelector('button[type="submit"]');
      if (weekly()) {
        const days = Array.from(dbox.querySelectorAll("input:checked")).map(c => Number(c.value));
        if (!days.length) { setStatus(st, "Pick at least one day of the week.", "err"); return; }
        const until = F("until").value;
        if (until && until < day) { setStatus(st, "The last day has to be after the first.", "err"); return; }
        const body = Object.assign(common, { days, time: time.padStart(5, "0"), startsOn: day, until: until || null });
        go.disabled = true;
        try {
          const r = sr ? await api("PUT", "coach/series/" + sr.id, body) : await api("POST", "coach/series", body);
          S.evEdit = null;
          renderEvForm();
          await loadCoach();
          const li = $("#seriesList").querySelector('[data-id="' + r.series.id + '"]');
          if (li) li.scrollIntoView({ block: "nearest" });
        } catch (err) { go.disabled = false; setStatus(st, err.message, "err"); }
        return;
      }
      const at = parseYmd(day); const [h, m] = time.split(":").map(Number); at.setHours(h, m, 0, 0);
      const body = Object.assign(common, {
        startsAt: at.toISOString(), result: F("result").value.trim(),
        reviews: F("kind").value === "film" ? Array.from(rbox.querySelectorAll("input:checked")).map(c => c.value) : []
      });
      go.disabled = true;
      try {
        const r = e ? await api("PUT", "coach/events/" + e.id, body) : await api("POST", "coach/events", body);
        const ne = normEvent(r.event);
        S.cEvents = S.cEvents.filter(x => x.id !== ne.id).concat([ne]);
        S.evEdit = null;
        renderEvForm(); renderSchedC();
        $("#schedListC").querySelector('[data-id="' + ne.id + '"]').scrollIntoView({ block: "nearest" });
      } catch (err) { go.disabled = false; setStatus(st, err.message, "err"); }
    });
    box.append(f);
    F("opponent").focus();
  }
  $("#evNew").addEventListener("click", () => { S.evEdit = S.evEdit === "new" ? null : "new"; renderEvForm(); });

  /* ---------- App install + notifications ---------- */
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isPhone = () => matchMedia("(max-width: 820px)").matches && navigator.maxTouchPoints > 0;
  const pushOK = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  let installEvt = null, swReg = null, pushSub = null, pushSynced = false;
  function unb64url(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(s + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0)); }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").then(async r => {
      swReg = r;
      try { pushSub = await r.pushManager.getSubscription(); } catch (_) {}
      syncPush(); renderAppBox();
    }).catch(() => {});
    navigator.serviceWorker.addEventListener("message", e => {
      const m = e.data || {};
      if (m.type === "refresh") refresh();
      else if (m.type === "go") goTo(m.url);
    });
  }
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; renderAppBox(); });
  window.addEventListener("appinstalled", () => { installEvt = null; renderAppBox(); });
  async function doInstall() {
    if (!installEvt) return;
    const ev = installEvt;
    ev.prompt();
    try { await ev.userChoice; } catch (_) {}
    installEvt = null;
    renderAppBox();
  }
  function pushState() {
    if (!pushOK()) return isIOS && !standalone() ? "ios-install" : "unsupported";
    if (Notification.permission === "denied") return "blocked";
    return pushSub && Notification.permission === "granted" ? "on" : "off";
  }
  const pushWhat = () => S.me && S.me.role === "coach" ? (S.me.team ? "replay review requests and schedule changes" : "replay review requests") : "Coach notes, replay reviews and schedule changes";
  function renderAppBox() {
    if (!S.me) { renderAppTip(); return; }
    const inst = standalone();
    $("#appInstallTxt").textContent = inst ? "\u2713 Installed on this device."
      : isIOS ? "On iPhone or iPad: open this site in Safari, tap Share, then Add to Home Screen."
      : installEvt ? "Install it to get its own icon and open full screen."
      : "Use your browser's menu: Install app or Add to Home screen.";
    $("#appInstall").hidden = inst || !installEvt;
    const st = pushState();
    $("#pushTxt").textContent = {
      "ios-install": "Add the app to your Home Screen first, then turn on notifications here.",
      unsupported: "This browser can't show notifications.",
      blocked: "Notifications are blocked for this site. Allow them in your browser or phone settings.",
      on: "On for this device: " + pushWhat() + ".",
      off: "Get " + pushWhat() + " on this device."
    }[st];
    $("#pushOn").hidden = st !== "off";
    $("#pushTest").hidden = $("#pushOff").hidden = st !== "on";
    renderAppTip();
  }
  // Phones only, one at a time: first "get the app", then (inside the app) "turn on notifications". Each can be dismissed.
  function renderAppTip() {
    const tip = $("#appTip");
    let kind = "", text = "", go = "";
    if (S.phase === "app" && isPhone() && !S.me.admin) {
      if (!standalone() && pref.get("tip:install") !== "0") {
        kind = "install"; go = installEvt ? "Install" : "";
        text = isIOS ? "Get the app: tap Share, then Add to Home Screen." : installEvt ? "Get the app on your home screen." : "Get the app: open your browser menu and tap Add to Home screen.";
      } else if (standalone() && pushState() === "off" && pref.get("tip:push") !== "0") {
        kind = "push"; go = "Turn on"; text = "Turn on notifications for " + pushWhat() + ".";
      }
    }
    tip.hidden = !kind;
    tip.dataset.kind = kind;
    $("#appTipText").textContent = text;
    $("#appTipGo").textContent = go;
    $("#appTipGo").hidden = !go;
  }
  $("#appTipX").addEventListener("click", () => { pref.set("tip:" + $("#appTip").dataset.kind, "0"); renderAppTip(); });
  $("#appTipGo").addEventListener("click", () => { if ($("#appTip").dataset.kind === "install") doInstall(); else pushEnable(); });
  $("#appInstall").addEventListener("click", doInstall);
  async function pushEnable() {
    const st = $("#pushStatus");
    setStatus(st, "");
    try {
      // Has to be the first thing after the tap, or phones ignore it.
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { renderAppBox(); return; }
      const reg = swReg || await navigator.serviceWorker.ready;
      const { key } = await api("GET", "push/key");
      pushSub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64url(key) });
      await api("POST", "push/subscribe", pushSub.toJSON());
      pushSynced = true;
      setStatus(st, "Notifications are on.", "ok");
    } catch (err) { setStatus(st, err.message || "Couldn't turn on notifications.", "err"); }
    renderAppBox();
  }
  async function pushDisable() {
    const sub = pushSub;
    pushSub = null;
    if (sub) {
      try { await api("POST", "push/unsubscribe", { endpoint: sub.endpoint }); } catch (_) {}
      try { await sub.unsubscribe(); } catch (_) {}
    }
    setStatus($("#pushStatus"), "Notifications are off for this device.", "ok");
    renderAppBox();
  }
  $("#pushOn").addEventListener("click", pushEnable);
  $("#pushOff").addEventListener("click", pushDisable);
  $("#pushTest").addEventListener("click", async () => {
    const st = $("#pushStatus"), b = $("#pushTest");
    b.disabled = true;
    try {
      const r = await api("POST", "push/test", {});
      setStatus(st, r.sent ? "Sent. It should show up in a few seconds." : "Couldn't reach this device. Turn notifications off and on again.", r.sent ? "ok" : "err");
    } catch (err) { setStatus(st, err.message, "err"); }
    finally { b.disabled = false; }
  });
  // A device that already allowed notifications is re-linked to whoever is signed in.
  function syncPush() {
    if (pushSynced || !S.me || S.me.admin || !pushSub || !pushOK() || Notification.permission !== "granted") return;
    pushSynced = true;
    api("POST", "push/subscribe", pushSub.toJSON()).catch(() => { pushSynced = false; });
  }
  // Tapping a notification opens the right section (?go=reviews or ?go=week&wk=YYYY-MM-DD).
  function goTo(url) {
    let q;
    try { q = new URL(url, location.origin).searchParams; } catch (_) { return; }
    const go = q.get("go");
    if (!go || S.phase !== "app") return;
    if (go === "reviews" && S.me.role === "coach") {
      if (S.view !== "coach") setView("coach");
      loadCoach();
      showWin("#winReviews");
    } else if (go === "schedule") {
      if (pageOk("schedule")) setPage("schedule");
    } else if (go === "week") {
      if (S.view !== "player") setView("player");
      const wk = q.get("wk");
      if (wk && /^\d{4}-\d{2}-\d{2}$/.test(wk)) { S.wk = mondayOf(wk); renderWeek(); }
      showWin("#winWeek");
    }
    refresh();
  }

  /* ---------- Render all ---------- */
  function renderAll() {
    const app = S.phase === "app";
    $("#loadingNote").hidden = S.phase !== "loading";
    $("#winAuth").hidden = S.phase !== "auth" || S.missing;
    $("#winMissing").hidden = !S.missing;
    if (S.phase === "auth") renderAuth();
    const coach = app && S.me.role === "coach";
    if (!coach && S.view === "coach") S.view = "player";
    if (app && S.me.admin) S.view = "coach";
    if (app && !pageOk(S.page)) S.page = pagesFor(S.view)[0][0];
    // Sections a coach turned off, and the schedule for players whose roster doesn't see it.
    $("#winRanks").hidden = !feat("ranks");
    $("#adminBar").hidden = !(app && S.me.admin);
    if (app && S.me.admin) $("#adminBarText").textContent = "You're managing " + ((S.school && S.school.name) || "this team") + " as the Backpost admin. Changes save for the whole team." + (S.paused ? " This team is paused, so its members can't sign in." : "");
    const acct = app && S.page === "account";
    $("#viewPlayer").hidden = !(app && S.view === "player" && !acct);
    $("#viewCoach").hidden = !(app && S.view === "coach" && !acct);
    $("#winAccount").hidden = !acct;
    document.querySelectorAll(".view .page").forEach(pg => { pg.hidden = pg.dataset.page !== S.page; });
    document.body.dataset.page = app ? S.page : "";
    renderHeader();
    renderConn();
    renderNav();
    renderAppBox();
    if (!app) return;
    renderAccount();
    renderToday(); renderWeek(); renderRanks(); renderSched();
    if (coach) { renderCoach(); renderSchedC(); renderSettingsForm(false); }
  }

  /* ---------- Load + refresh ---------- */
  async function loadMine() {
    const [me, wk, hi, rv, ev] = await Promise.all([api("GET", "me"), api("GET", "weeks"), api("GET", "ranks/history").catch(() => null), api("GET", "reviews").catch(() => null), feat("schedule") ? api("GET", "events").catch(() => null) : null]);
    S.schedAccess = !!(ev && ev.access);
    S.events = ev && ev.events ? ev.events.map(normEvent) : [];
    if (hi) S.myHist = normHist(hi.history);
    if (rv) S.myReviews = (rv.reviews || []).map(normReview);
    const fresh = normUser(me.me);
    if (dirty.has("me") && S.me) { fresh.active = S.me.active; fresh.customFocus = S.me.customFocus; fresh.prefs = S.me.prefs; }
    if (fresh.admin) { let saved = null; try { saved = JSON.parse(pref.get("adminPrefs") || "null"); } catch (_) {} fresh.prefs = S.me && S.me.admin ? S.me.prefs : normPrefs(saved); }
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
    catch (err) {
      S.phase = "auth";
      if (err.status === 404) S.missing = true;
      renderAll();
      if (!S.missing) setStatus($("#authStatus"), err.message, "err");
      return;
    }
    S.needsSetup = false;
    S.school = st.school || null;
    S.paused = !!st.paused;
    S.settings = normSettings(st.settings);
    if (!st.me || (st.me.admin && S.adminSkip)) { S.phase = "auth"; renderAll(); $("#authName").focus(); return; }
    try { await loadMine(); }
    catch (err) { S.phase = "auth"; renderAll(); setStatus($("#authStatus"), err.message, "err"); return; }
    S.phase = "app";
    S.view = S.me.role === "coach" ? (pref.get("view") === "player" && !S.me.admin ? "player" : "coach") : "player";
    const fromHash = location.hash.slice(1);
    S.page = fromHash && fromHash !== "account" && pageOk(fromHash) ? fromHash : pagesFor(S.view)[0][0];
    try { history.replaceState(null, "", location.pathname + location.search + "#" + S.page); } catch (_) {}
    renderAll();
    loadBoard();
    if (S.me.role === "coach") loadCoach();
    syncPush();
    $("#poweredLink").href = "https://getbackpost.com";
    if (/[?&]go=/.test(location.search)) { const u = location.href; history.replaceState(null, "", ROUTE.base); goTo(u); }
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
  // This copy of the script ran: a later loading problem can recover again.
  try { sessionStorage.removeItem("bp:recovered"); } catch (_) {}
})();
