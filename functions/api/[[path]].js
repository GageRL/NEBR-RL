/*
 * Nebraska Esports training hub: API for every /api/* request.
 * Cloudflare Pages Function. Needs a D1 database bound as DB.
 * Tables are created automatically on first use.
 */

const SESSION_DAYS = 30;
const PW_ITER = 25000;
const MAX_BODY = 256 * 1024;
const LOCK_AFTER = 8;
const LOCK_MS = 10 * 60 * 1000;

const PL = ["duel", "doubles", "standard"];
const TIER_BASES = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Champion", "Grand Champion"];
const TIERS = ["Unranked"].concat(TIER_BASES.flatMap(t => [t + " I", t + " II", t + " III"]), ["Supersonic Legend"]);
const DIVS = ["Div I", "Div II", "Div III", "Div IV"];
const TYPES = ["ranked", "training"];
const TEAMS = ["varsity", "white", "black"];
const DEFAULT_SETTINGS = {
  title: "Nebraska Esports",
  targets: { hours: 15, minDays: 0 },
  rankedGoals: { duel: { min: 5, max: 10 }, doubles: { min: 15, max: 20 }, standard: { min: null, max: null } }
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     username TEXT NOT NULL UNIQUE COLLATE NOCASE,
     role TEXT NOT NULL,
     team TEXT,
     pw_hash TEXT NOT NULL,
     tracker_url TEXT,
     ranks TEXT,
     active TEXT,
     custom_focus TEXT,
     fail_count INTEGER NOT NULL DEFAULT 0,
     locked_until INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     expires_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS weeks (
     user_id TEXT NOT NULL,
     week TEXT NOT NULL,
     data TEXT NOT NULL,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, week)
   )`,
  `CREATE INDEX IF NOT EXISTS weeks_week ON weeks(week)`,
  `CREATE TABLE IF NOT EXISTS settings (
     id INTEGER PRIMARY KEY,
     data TEXT NOT NULL
   )`
];
let schemaReady = false;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}

/* ---------- small helpers ---------- */
const enc = new TextEncoder();
const isPlain = v => v !== null && typeof v === "object" && !Array.isArray(v);
const parse = (s, def) => { try { const v = JSON.parse(s); return v === null || v === undefined ? def : v; } catch (_) { return def; } };
function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}
function numIn(v, def, max) {
  if (v === null || v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : def;
}
function cleanName(v) {
  // eslint-disable-next-line no-control-regex
  return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ").slice(0, 32);
}
function trackerUrl(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?(?:rocketleague\.tracker\.network|tracker\.gg)\/rocket-league\/profile\/([^/?#\s]+)\/([^/?#\s]+)/i);
  return m ? "https://rocketleague.tracker.network/rocket-league/profile/" + m[1] + "/" + m[2] + "/overview" : "";
}
function b64(buf) { let s = ""; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s); }
function unb64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
function hex(buf) { return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join(""); }
async function sha256hex(s) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
function newId() { return hex(crypto.getRandomValues(new Uint8Array(12))); }

/* ---------- passwords + sessions ---------- */
async function derive(pw, salt, iter) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  return b64(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
}
async function makePw(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return "pbkdf2$" + PW_ITER + "$" + b64(salt) + "$" + (await derive(pw, salt, PW_ITER));
}
async function checkPw(pw, stored) {
  const [kind, iter, salt, hash] = String(stored || "").split("$");
  if (kind !== "pbkdf2" || !iter || !salt || !hash) return false;
  const got = await derive(String(pw || ""), unb64(salt), Number(iter));
  if (got.length !== hash.length) return false;
  let r = 0;
  for (let i = 0; i < got.length; i++) r |= got.charCodeAt(i) ^ hash.charCodeAt(i);
  return r === 0;
}
function checkNewPw(pw, min) {
  const p = String(pw == null ? "" : pw);
  if (p.length < min) fail(400, "Password needs at least " + min + " characters.");
  if (p.length > 128) fail(400, "Password is too long.");
  return p;
}
function sessionToken(req) {
  const m = (req.headers.get("Cookie") || "").match(/(?:^|;\s*)ne_s=([a-f0-9]{64})/);
  return m ? m[1] : null;
}
function cookie(req, token, maxAge) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return "ne_s=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + maxAge + secure;
}
async function startSession(db, req, userId) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256hex(token), userId, now + SESSION_DAYS * 864e5)
  ]);
  return cookie(req, token, SESSION_DAYS * 86400);
}
async function currentUser(db, req) {
  const t = sessionToken(req);
  if (!t) return null;
  const row = await db.prepare("SELECT u.*, s.expires_at AS s_exp, s.token_hash AS s_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?").bind(await sha256hex(t)).first();
  if (!row || row.s_exp < Date.now()) return null;
  return row;
}

/* ---------- data shapes ---------- */
function normSettings(raw) {
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  if (!isPlain(raw)) return s;
  if (typeof raw.title === "string" && raw.title.trim()) s.title = raw.title.trim().replace(/\s+/g, " ").slice(0, 60);
  const t = isPlain(raw.targets) ? raw.targets : {};
  s.targets.hours = Math.round(numIn(t.hours, s.targets.hours, 80) * 2) / 2;
  s.targets.minDays = Math.round(numIn(t.minDays, s.targets.minDays, 7));
  if (isPlain(raw.rankedGoals)) {
    for (const p of PL) {
      const g = isPlain(raw.rankedGoals[p]) ? raw.rankedGoals[p] : {};
      let min = numOrNull(g.min), max = numOrNull(g.max);
      if (min !== null) min = Math.min(min, 60);
      if (max !== null) max = Math.min(max, 60);
      if (min === null && max !== null) min = max;
      if (max === null && min !== null) max = min;
      if (min !== null && max < min) { const x = min; min = max; max = x; }
      if (max === 0) { min = null; max = null; }
      s.rankedGoals[p] = { min, max };
    }
  }
  return s;
}
function normPlaylist(x) {
  const tier = TIERS.includes(x && x.tier) ? x.tier : null;
  let div = DIVS.includes(x && x.div) ? x.div : null;
  if (!tier || tier === "Unranked" || tier === "Supersonic Legend") div = null;
  return { tier, div, mmr: numOrNull(x && x.mmr), games: numOrNull(x && x.games) };
}
function normRanks(raw) {
  const r = isPlain(raw) ? raw : {};
  const out = { playlists: {}, mmrChange: {}, pulledAt: typeof r.pulledAt === "string" ? r.pulledAt : null, ranksAt: typeof r.ranksAt === "string" ? r.ranksAt : null };
  for (const p of PL) {
    out.playlists[p] = normPlaylist(isPlain(r.playlists) ? r.playlists[p] : null);
    const ch = isPlain(r.mmrChange) ? r.mmrChange[p] : null;
    out.mmrChange[p] = typeof ch === "number" && Number.isFinite(ch) ? Math.round(ch) : null;
  }
  return out;
}
function applyRanks(prevRaw, incoming, pulled) {
  const prev = normRanks(prevRaw);
  const now = new Date().toISOString();
  const next = normRanks(prev);
  for (const p of PL) {
    if (!isPlain(incoming) || !isPlain(incoming[p])) continue;
    const x = normPlaylist(incoming[p]);
    const old = prev.playlists[p].mmr;
    next.mmrChange[p] = old !== null && x.mmr !== null ? x.mmr - old : null;
    next.playlists[p] = x;
  }
  next.ranksAt = now;
  if (pulled) next.pulledAt = now;
  return next;
}
function normActive(a) {
  if (a === null) return null;
  if (!isPlain(a) || typeof a.id !== "string" || a.id.length > 40 || !/^\d{4}-\d{2}-\d{2}$/.test(a.week) || !TYPES.includes(a.type) || typeof a.startedAt !== "string" || isNaN(Date.parse(a.startedAt))) fail(400, "That session couldn't be saved.");
  return { id: a.id, week: a.week, type: a.type, startedAt: a.startedAt, date: /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : a.week };
}
function normFocus(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const f of list) { const s = cleanName(f).slice(0, 30); if (s && !out.some(o => o.toLowerCase() === s.toLowerCase())) out.push(s); }
  return out.slice(0, 30);
}
function pub(u) {
  return {
    id: u.id, name: u.username, role: u.role,
    team: TEAMS.includes(u.team) ? u.team : null,
    trackerUrl: u.tracker_url || "",
    ranks: normRanks(parse(u.ranks, {})),
    active: parse(u.active, null),
    customFocus: parse(u.custom_focus, []),
    createdAt: u.created_at
  };
}
async function getSettings(db) {
  const row = await db.prepare("SELECT data FROM settings WHERE id = 1").first();
  return normSettings(row ? parse(row.data, null) : null);
}
async function nameTaken(db, name, exceptId) {
  const row = await db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").bind(name).first();
  return !!row && row.id !== exceptId;
}
function weekId(v) { if (!/^\d{4}-\d{2}-\d{2}$/.test(v || "")) fail(400, "Unknown week."); return v; }

/* Finished sessions are locked: once a session has ended, later saves can't change it.
   Sessions are only ever removed on purpose (listed in `remove`), never because a
   stale device left them out. Removed ids are remembered so they can't come back. */
function finishSession(s, now) {
  const start = Date.parse(s.startedAt);
  if (!Number.isFinite(start)) return null;
  let end = Date.parse(s.endedAt);
  if (!Number.isFinite(end) || end > now + 120000) end = now;
  if (end < start) end = start;
  const maxMin = Math.ceil((end - start) / 60000) + 1;
  s.endedAt = new Date(end).toISOString();
  s.minutes = Math.max(0, Math.min(Number(s.minutes) || 0, maxMin, 1440));
  return s;
}
function mergeWeek(stored, incoming, removeIds, now) {
  const removed = new Set((Array.isArray(stored.removed) ? stored.removed : []).concat(removeIds).filter(x => typeof x === "string"));
  const storedSessions = (Array.isArray(stored.sessions) ? stored.sessions : []).filter(s => isPlain(s) && typeof s.id === "string");
  const inSessions = (Array.isArray(incoming.sessions) ? incoming.sessions : []).filter(s => isPlain(s) && typeof s.id === "string" && s.id.length <= 40);
  const inById = new Map(inSessions.map(s => [s.id, s]));
  const storedIds = new Set(storedSessions.map(s => s.id));
  const out = [];
  for (const s of storedSessions) {
    if (removed.has(s.id)) continue;
    if (s.endedAt) { out.push(s); continue; }
    const inc = inById.get(s.id);
    if (!inc) { out.push(s); continue; }
    const next = Object.assign({}, inc, { id: s.id, type: s.type, startedAt: s.startedAt, date: s.date || inc.date, planId: s.planId || inc.planId || null });
    if (next.endedAt && !finishSession(next, now)) continue;
    out.push(next);
  }
  for (const inc of inSessions) {
    if (storedIds.has(inc.id) || removed.has(inc.id)) continue;
    if (!TYPES.includes(inc.type) || typeof inc.startedAt !== "string") continue;
    const start = Date.parse(inc.startedAt);
    if (!Number.isFinite(start) || start > now + 120000) continue;
    const next = Object.assign({}, inc);
    if (next.endedAt && !finishSession(next, now)) continue;
    out.push(next);
  }
  out.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  return { plan: isPlain(incoming.plan) ? incoming.plan : {}, sessions: out, removed: Array.from(removed).slice(-300) };
}

/* ---------- request plumbing ---------- */
async function readJson(req) {
  const len = Number(req.headers.get("Content-Length") || 0);
  if (len > MAX_BODY) fail(413, "That's too much to save at once.");
  const text = await req.text();
  if (text.length > MAX_BODY) fail(413, "That's too much to save at once.");
  if (!text) return {};
  try { const v = JSON.parse(text); return isPlain(v) ? v : fail(400, "Bad request."); }
  catch (e) { if (e instanceof HttpError) throw e; fail(400, "Bad request."); }
}
function checkOrigin(req) {
  const origin = req.headers.get("Origin");
  if (origin && origin !== new URL(req.url).origin) fail(403, "Request blocked.");
  // Cross-site forms can only send simple POSTs; requiring JSON blocks them. PUT/PATCH/DELETE always need CORS approval.
  const ct = req.headers.get("Content-Type") || "";
  if (req.method === "POST" && !ct.toLowerCase().startsWith("application/json")) fail(415, "Bad request.");
}

export async function onRequest({ request, env, params }) {
  try {
    if (!env.DB) return json({ error: "The site's database isn't connected yet." }, 503);
    const db = env.DB;
    if (!schemaReady) {
      await db.batch(SCHEMA.map(s => db.prepare(s)));
      const cols = await db.prepare("PRAGMA table_info(users)").all();
      if (!(cols.results || []).some(c => c.name === "team")) await db.prepare("ALTER TABLE users ADD COLUMN team TEXT").run();
      schemaReady = true;
    }
    const segs = (Array.isArray(params.path) ? params.path : [params.path]).filter(Boolean);
    const method = request.method;
    let body = null;
    if (method !== "GET" && method !== "HEAD") { checkOrigin(request); body = await readJson(request); }
    const user = await currentUser(db, request);
    return await route(db, request, method, segs, body || {}, user);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e && e.stack ? e.stack : e);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
}

async function route(db, req, method, segs, body, user) {
  const [a, b, c] = segs;
  const key = method + " " + [a, b].filter(Boolean).join("/");

  /* ----- public ----- */
  if (key === "GET state") {
    const hasCoach = await db.prepare("SELECT 1 AS x FROM users WHERE role = 'coach' LIMIT 1").first();
    const settings = await getSettings(db);
    return json({ needsSetup: !hasCoach, me: user ? pub(user) : null, settings: user ? settings : { title: settings.title } });
  }
  if (key === "POST setup") {
    const name = cleanName(body.name);
    if (!name) fail(400, "Enter a name.");
    const pw = checkNewPw(body.password, 8);
    const id = newId();
    const res = await db.prepare("INSERT INTO users (id, username, role, pw_hash, created_at) SELECT ?, ?, 'coach', ?, ? WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'coach')")
      .bind(id, name, await makePw(pw), Date.now()).run();
    if (!res.meta || !res.meta.changes) fail(409, "The coach account already exists.");
    const u = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
    return json({ me: pub(u) }, 200, { "Set-Cookie": await startSession(db, req, id) });
  }
  if (key === "POST login") {
    const name = cleanName(body.name);
    const u = name ? await db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").bind(name).first() : null;
    if (!u) { await derive("x", new Uint8Array(16), PW_ITER); fail(401, "Wrong name or password."); }
    if (u.locked_until > Date.now()) fail(429, "Too many tries. Wait a few minutes.");
    if (!(await checkPw(body.password, u.pw_hash))) {
      const fails = u.fail_count + 1;
      const lock = fails >= LOCK_AFTER;
      await db.prepare("UPDATE users SET fail_count = ?, locked_until = ? WHERE id = ?").bind(lock ? 0 : fails, lock ? Date.now() + LOCK_MS : 0, u.id).run();
      fail(lock ? 429 : 401, lock ? "Too many tries. Wait a few minutes." : "Wrong name or password.");
    }
    if (u.fail_count) await db.prepare("UPDATE users SET fail_count = 0, locked_until = 0 WHERE id = ?").bind(u.id).run();
    return json({ me: pub(u) }, 200, { "Set-Cookie": await startSession(db, req, u.id) });
  }
  if (key === "POST logout") {
    if (user) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(user.s_hash).run();
    return json({ ok: true }, 200, { "Set-Cookie": cookie(req, "", 0) });
  }

  if (!user) fail(401, "Signed out. Sign on again.");

  /* ----- signed-in user ----- */
  if (key === "GET me") return json({ me: pub(user) });
  if (key === "PATCH me") {
    const sets = [], vals = [];
    if ("active" in body) { sets.push("active = ?"); vals.push(JSON.stringify(normActive(body.active))); }
    if ("customFocus" in body) { sets.push("custom_focus = ?"); vals.push(JSON.stringify(normFocus(body.customFocus))); }
    if (sets.length) await db.prepare("UPDATE users SET " + sets.join(", ") + " WHERE id = ?").bind(...vals, user.id).run();
    const u = await db.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first();
    return json({ me: pub(u) });
  }
  if (key === "POST password") {
    if (!(await checkPw(body.current, user.pw_hash))) fail(400, "Current password is wrong.");
    const pw = checkNewPw(body.next, user.role === "coach" ? 8 : 6);
    await db.batch([
      db.prepare("UPDATE users SET pw_hash = ? WHERE id = ?").bind(await makePw(pw), user.id),
      db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?").bind(user.id, user.s_hash)
    ]);
    return json({ ok: true });
  }
  if (key === "GET weeks") {
    const { results } = await db.prepare("SELECT week, data FROM weeks WHERE user_id = ? ORDER BY week DESC LIMIT 80").bind(user.id).all();
    return json({ weeks: results.map(r => ({ week: r.week, data: parse(r.data, {}) })) });
  }
  if (method === "PUT" && a === "weeks" && b && !c) {
    const wk = weekId(b);
    if (!isPlain(body.data)) fail(400, "Bad request.");
    const removeIds = Array.isArray(body.remove) ? body.remove.filter(x => typeof x === "string").slice(0, 100) : [];
    const row = await db.prepare("SELECT data FROM weeks WHERE user_id = ? AND week = ?").bind(user.id, wk).first();
    const stored = row ? parse(row.data, {}) : {};
    const merged = mergeWeek(isPlain(stored) ? stored : {}, body.data, removeIds, Date.now());
    merged.week = wk;
    const data = JSON.stringify(merged);
    if (data.length > 200000) fail(413, "That week has too much in it to save.");
    await db.prepare("INSERT INTO weeks (user_id, week, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, week) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
      .bind(user.id, wk, data, Date.now()).run();
    return json({ data: merged });
  }

  /* ----- coach only ----- */
  if (a === "coach") {
    if (user.role !== "coach") fail(403, "Coach only.");

    if (key === "GET coach/players") {
      const { results } = await db.prepare("SELECT * FROM users ORDER BY username COLLATE NOCASE").all();
      return json({ players: results.map(pub) });
    }
    if (key === "POST coach/players") {
      const name = cleanName(body.name);
      if (!name) fail(400, "Enter a name.");
      if (await nameTaken(db, name, null)) fail(409, "That name is taken.");
      const pw = checkNewPw(body.password, 6);
      const raw = String(body.trackerUrl || "").trim();
      const url = trackerUrl(raw);
      if (raw && !url) fail(400, "That isn't a Rocket League Tracker profile link.");
      const id = newId();
      const team = TEAMS.includes(body.team) ? body.team : "varsity";
      await db.prepare("INSERT INTO users (id, username, role, team, pw_hash, tracker_url, created_at) VALUES (?, ?, 'player', ?, ?, ?, ?)")
        .bind(id, name, team, await makePw(pw), url || null, Date.now()).run();
      const u = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
      return json({ player: pub(u) });
    }
    if (b === "players" && c && segs[3] === "sessions" && method === "DELETE") {
      const wk = weekId(segs[4]), sid = segs[5];
      if (!sid) fail(400, "Bad request.");
      const target = await db.prepare("SELECT id, active FROM users WHERE id = ?").bind(c).first();
      if (!target) fail(404, "That player no longer exists.");
      const row = await db.prepare("SELECT data FROM weeks WHERE user_id = ? AND week = ?").bind(c, wk).first();
      const d = row ? parse(row.data, {}) : {};
      const sessions = Array.isArray(d.sessions) ? d.sessions : [];
      d.sessions = sessions.filter(s => !(isPlain(s) && s.id === sid));
      d.removed = (Array.isArray(d.removed) ? d.removed : []).concat([sid]).slice(-300);
      d.week = wk;
      const ops = [db.prepare("INSERT INTO weeks (user_id, week, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, week) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(c, wk, JSON.stringify(d), Date.now())];
      const act = parse(target.active, null);
      if (isPlain(act) && act.id === sid) ops.push(db.prepare("UPDATE users SET active = 'null' WHERE id = ?").bind(c));
      await db.batch(ops);
      return json({ ok: true });
    }
    if (b === "players" && c && (method === "PATCH" || method === "DELETE")) {
      const target = await db.prepare("SELECT * FROM users WHERE id = ?").bind(c).first();
      if (!target) fail(404, "That player no longer exists.");
      if (method === "DELETE") {
        if (target.role === "coach") fail(400, "The coach account can't be removed.");
        await db.batch([
          db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(c),
          db.prepare("DELETE FROM weeks WHERE user_id = ?").bind(c),
          db.prepare("DELETE FROM users WHERE id = ?").bind(c)
        ]);
        return json({ ok: true });
      }
      const sets = [], vals = [], extra = [];
      if ("name" in body) {
        const name = cleanName(body.name);
        if (!name) fail(400, "Enter a name.");
        if (await nameTaken(db, name, c)) fail(409, "That name is taken.");
        sets.push("username = ?"); vals.push(name);
      }
      if ("team" in body) {
        if (target.role === "coach") fail(400, "The coach isn't on a roster.");
        if (!TEAMS.includes(body.team)) fail(400, "Pick Varsity, White, or Black.");
        sets.push("team = ?"); vals.push(body.team);
      }
      if ("trackerUrl" in body) {
        const raw = String(body.trackerUrl || "").trim();
        const url = trackerUrl(raw);
        if (raw && !url) fail(400, "That isn't a Rocket League Tracker profile link.");
        sets.push("tracker_url = ?"); vals.push(url || null);
      }
      if ("password" in body) {
        if (target.role === "coach") fail(400, "Change the coach password from Account.");
        const pw = checkNewPw(body.password, 6);
        sets.push("pw_hash = ?", "fail_count = 0", "locked_until = 0"); vals.push(await makePw(pw));
        extra.push(db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(c));
      }
      if ("ranks" in body) { sets.push("ranks = ?"); vals.push(JSON.stringify(applyRanks(parse(target.ranks, {}), body.ranks, false))); }
      if (sets.length) await db.batch([db.prepare("UPDATE users SET " + sets.join(", ") + " WHERE id = ?").bind(...vals, c)].concat(extra));
      const u = await db.prepare("SELECT * FROM users WHERE id = ?").bind(c).first();
      return json({ player: pub(u) });
    }
    if (key === "GET coach/weeks" && c) {
      const wk = weekId(c);
      const { results } = await db.prepare("SELECT user_id, data FROM weeks WHERE week = ?").bind(wk).all();
      return json({ week: wk, weeks: results.map(r => ({ userId: r.user_id, data: parse(r.data, {}) })) });
    }
    if (key === "PUT coach/settings") {
      const s = normSettings(body.settings);
      await db.prepare("INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data").bind(JSON.stringify(s)).run();
      return json({ settings: s });
    }
    if (key === "GET coach/trackers") {
      const { results } = await db.prepare("SELECT id, username, tracker_url FROM users WHERE tracker_url IS NOT NULL AND tracker_url <> '' ORDER BY username COLLATE NOCASE").all();
      return json({ players: results.map(r => ({ id: r.id, name: r.username, trackerUrl: r.tracker_url })) });
    }
    if (key === "POST coach/ranks") {
      const updates = Array.isArray(body.updates) ? body.updates.slice(0, 200) : fail(400, "Bad request.");
      let saved = 0;
      for (const up of updates) {
        if (!isPlain(up) || typeof up.id !== "string" || !isPlain(up.playlists)) continue;
        const row = await db.prepare("SELECT ranks FROM users WHERE id = ?").bind(up.id).first();
        if (!row) continue;
        await db.prepare("UPDATE users SET ranks = ? WHERE id = ?").bind(JSON.stringify(applyRanks(parse(row.ranks, {}), up.playlists, true)), up.id).run();
        saved++;
      }
      return json({ saved });
    }
  }

  fail(404, "Not found.");
}
