import { generateVapid, sendPush, isPushEndpoint, unb64url } from "../../lib/webpush.js";
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
// Team is a label only. Casual is for players who aren't on Varsity, White or Black.
const TEAMS = ["varsity", "white", "black", "casual"];
const DEFAULT_SETTINGS = {
  title: "Nebraska Esports",
  targets: { ranked: 3, training: 2, minGames: 5, minMinutes: 30 },
  rankedGoals: { duel: { min: 5, max: 10 }, doubles: { min: 15, max: 20 }, standard: { min: null, max: null } },
  targetsLog: [],
  schedTeams: ["varsity", "white", "black"]
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
     targets TEXT,
     prefs TEXT,
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
   )`,
  `CREATE TABLE IF NOT EXISTS rank_history (
     user_id TEXT NOT NULL,
     at INTEGER NOT NULL,
     duel INTEGER,
     doubles INTEGER,
     standard INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS rank_history_user ON rank_history(user_id, at)`,
  `CREATE TABLE IF NOT EXISTS reviews (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     week TEXT NOT NULL,
     session_id TEXT NOT NULL,
     playlist TEXT,
     link TEXT,
     note TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'open',
     created_at INTEGER NOT NULL,
     done_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS reviews_user ON reviews(user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS push_subs (
     endpoint TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     p256dh TEXT NOT NULL,
     auth TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs(user_id)`,
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS events (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     opponent TEXT NOT NULL,
     starts_at INTEGER NOT NULL,
     format TEXT,
     details TEXT,
     link TEXT,
     teams TEXT NOT NULL,
     result TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS events_start ON events(starts_at)`,
  `CREATE TABLE IF NOT EXISTS rsvps (
     event_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     status TEXT NOT NULL,
     at INTEGER NOT NULL,
     PRIMARY KEY (event_id, user_id)
   )`
];
const HISTORY_DAYS = 120;
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
/* Weekly requirements are kept as a log of { from: Monday, ... } entries. An entry applies from its
   week on, so changing a requirement never rewrites past weeks. */
const LOG_START = "2000-01-03";
const isWeek = v => /^\d{4}-\d{2}-\d{2}$/.test(v || "");
const intIn = (v, max) => Math.min(max, Math.max(0, Math.round(Number(v) || 0)));
function normTeamLog(list) {
  return (Array.isArray(list) ? list : []).filter(e => isPlain(e) && isWeek(e.from))
    .map(e => ({ from: e.from, ranked: intIn(e.ranked, 14), training: intIn(e.training, 14), minGames: intIn(e.minGames, 60), minMinutes: intIn(e.minMinutes, 300) }))
    .sort((a, b) => a.from.localeCompare(b.from)).slice(-200);
}
function normPlayerLog(list) {
  const own = v => (v === null || v === undefined || v === "" ? null : intIn(v, 14));
  return (Array.isArray(list) ? list : []).filter(e => isPlain(e) && isWeek(e.from))
    .map(e => ({ from: e.from, ranked: own(e.ranked), training: own(e.training) }))
    .sort((a, b) => a.from.localeCompare(b.from)).slice(-200);
}
// The week a change applies from: the Monday the coach's device sent (if it's within a week of now), else this UTC week.
function weekFrom(v) {
  const now = Date.now();
  if (isWeek(v)) { const t = Date.parse(v + "T00:00:00Z"); if (Math.abs(t - now) < 9 * 864e5 && new Date(t).getUTCDay() === 1) return v; }
  const d = new Date(now); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function logPut(log, entry, seed) {
  const out = log.length ? log.slice() : [seed];
  return out.filter(e => e.from !== entry.from).concat([entry]).sort((a, b) => a.from.localeCompare(b.from)).slice(-200);
}
function normSettings(raw) {
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  if (!isPlain(raw)) return s;
  if (typeof raw.title === "string" && raw.title.trim()) s.title = raw.title.trim().replace(/\s+/g, " ").slice(0, 60);
  const t = isPlain(raw.targets) ? raw.targets : {};
  s.targets.ranked = Math.round(numIn(t.ranked, s.targets.ranked, 14));
  s.targets.training = Math.round(numIn(t.training, s.targets.training, 14));
  s.targets.minGames = Math.round(numIn(t.minGames, s.targets.minGames, 60));
  s.targets.minMinutes = Math.round(numIn(t.minMinutes, s.targets.minMinutes, 300));
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
  s.targetsLog = normTeamLog(raw.targetsLog);
  if (Array.isArray(raw.schedTeams)) s.schedTeams = TEAMS.filter(t => raw.schedTeams.includes(t));
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
/* Per-person page layout: for each view, the sections in order with column, width and height. */
const LAYOUT_H = ["auto", "s", "m", "l"];
function normPrefs(raw) {
  const out = { layout: {} };
  const lay = isPlain(raw) && isPlain(raw.layout) ? raw.layout : {};
  for (const view of ["player", "coach"]) {
    if (!Array.isArray(lay[view])) continue;
    out.layout[view] = lay[view].filter(x => isPlain(x) && /^win[A-Za-z]{2,20}$/.test(x.id)).slice(0, 12)
      .map(x => ({ id: x.id, lane: x.lane === 1 ? 1 : 0, wide: !!x.wide, h: LAYOUT_H.includes(x.h) ? x.h : "auto" }));
  }
  return out;
}
const REVIEW_PL = ["", "duel", "doubles", "standard"];
function pubReview(r) {
  return { id: r.id, userId: r.user_id, name: r.username || undefined, week: r.week, sessionId: r.session_id, playlist: r.playlist || "", link: r.link || "", note: r.note, status: r.status, createdAt: r.created_at, doneAt: r.done_at || null };
}
function pub(u) {
  return {
    id: u.id, name: u.username, role: u.role,
    team: TEAMS.includes(u.team) ? u.team : (u.role === "player" ? "varsity" : null),
    trackerUrl: u.tracker_url || "",
    ranks: normRanks(parse(u.ranks, {})),
    active: parse(u.active, null),
    customFocus: parse(u.custom_focus, []),
    targetsLog: normPlayerLog(parse(u.targets, [])),
    prefs: normPrefs(parse(u.prefs, {})),
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
// Coach notes and coach edits are written only through the coach routes; anything a player sends is dropped.
function stripCoachFields(s) { delete s.coachNote; delete s.coachNoteAt; delete s.coachEditedAt; return s; }

/* Coach edit of a finished session. Same week only; times can't be in the future; at most 24 hours.
   A Training session has no games. Notes, id and the coach note are kept. */
function cleanText(v, max) {
  // eslint-disable-next-line no-control-regex
  return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, max);
}
function addDaysYmd(ymd, n) { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function applyCoachEdit(s, inc, wk, now) {
  if (!isPlain(inc)) fail(400, "Bad request.");
  if (!TYPES.includes(inc.type)) fail(400, "Pick a session type.");
  const date = String(inc.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < wk || date > addDaysYmd(wk, 6)) fail(400, "Pick a day in this week.");
  const start = Date.parse(inc.startedAt), end = Date.parse(inc.endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) fail(400, "Enter a start and end time.");
  if (end <= start) fail(400, "End time has to be after the start time.");
  if (end - start > 24 * 3600000) fail(400, "A session can't be longer than 24 hours.");
  if (end > now + 120000 && !(inc.endedAt === s.endedAt)) fail(400, "End time can't be in the future.");
  const games = {};
  for (const p of PL) {
    const g = isPlain(inc.games) && isPlain(inc.games[p]) ? inc.games[p] : {};
    const n = v => Math.min(300, Math.max(0, Math.floor(Number(v) || 0)));
    games[p] = inc.type === "ranked" ? { w: n(g.w), l: n(g.l) } : { w: 0, l: 0 };
  }
  // Unchanged times keep the logged duration (a player may have checked out with a corrected time).
  const sameTimes = inc.startedAt === s.startedAt && inc.endedAt === s.endedAt;
  s.type = inc.type;
  s.date = date;
  if (!sameTimes) {
    s.startedAt = new Date(start).toISOString();
    s.endedAt = new Date(end).toISOString();
    s.minutes = Math.max(1, Math.round((end - start) / 60000));
  }
  s.games = games;
  s.warmup = !!inc.warmup;
  s.focuses = inc.type === "training" ? normFocus(inc.focuses).slice(0, 20) : [];
  for (const k of ["did", "well", "cost", "next"]) s[k] = cleanText(inc[k], 4000);
  s.coachEditedAt = new Date(now).toISOString();
  return s;
}

/* Rank history: one row per update where any MMR changed. Feeds the trend line and "this week". */
async function recordHistory(db, userId, ranks) {
  const pl = isPlain(ranks) && isPlain(ranks.playlists) ? ranks.playlists : {};
  const v = PL.map(p => (isPlain(pl[p]) && Number.isFinite(pl[p].mmr) ? pl[p].mmr : null));
  if (v.every(x => x === null)) return;
  const last = await db.prepare("SELECT duel, doubles, standard FROM rank_history WHERE user_id = ? ORDER BY at DESC LIMIT 1").bind(userId).first();
  if (last && last.duel === v[0] && last.doubles === v[1] && last.standard === v[2]) return;
  await db.prepare("INSERT INTO rank_history (user_id, at, duel, doubles, standard) VALUES (?, ?, ?, ?, ?)").bind(userId, Date.now(), v[0], v[1], v[2]).run();
}
async function readHistory(db, userId) {
  const since = Date.now() - HISTORY_DAYS * 864e5;
  const { results } = await db.prepare("SELECT at, duel, doubles, standard FROM rank_history WHERE user_id = ? AND at >= ? ORDER BY at LIMIT 3000").bind(userId, since).all();
  // Keep the last point before the window too, so "this week" has a starting value.
  const before = await db.prepare("SELECT at, duel, doubles, standard FROM rank_history WHERE user_id = ? AND at < ? ORDER BY at DESC LIMIT 1").bind(userId, since).first();
  return (before ? [before] : []).concat(results);
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
    stripCoachFields(next);
    if (next.endedAt && !finishSession(next, now)) continue;
    out.push(next);
  }
  for (const inc of inSessions) {
    if (storedIds.has(inc.id) || removed.has(inc.id)) continue;
    if (!TYPES.includes(inc.type) || typeof inc.startedAt !== "string") continue;
    const start = Date.parse(inc.startedAt);
    if (!Number.isFinite(start) || start > now + 120000) continue;
    const next = stripCoachFields(Object.assign({}, inc));
    if (next.endedAt && !finishSession(next, now)) continue;
    out.push(next);
  }
  out.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  return { sessions: out, removed: Array.from(removed).slice(-300) };
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

export async function onRequest({ request, env, params, waitUntil }) {
  try {
    if (!env.DB) return json({ error: "The site's database isn't connected yet." }, 503);
    const db = env.DB;
    if (!schemaReady) {
      await db.batch(SCHEMA.map(s => db.prepare(s)));
      const cols = await db.prepare("PRAGMA table_info(users)").all();
      if (!(cols.results || []).some(c => c.name === "team")) await db.prepare("ALTER TABLE users ADD COLUMN team TEXT").run();
      if (!(cols.results || []).some(c => c.name === "targets")) await db.prepare("ALTER TABLE users ADD COLUMN targets TEXT").run();
      if (!(cols.results || []).some(c => c.name === "prefs")) await db.prepare("ALTER TABLE users ADD COLUMN prefs TEXT").run();
      await db.prepare("UPDATE users SET team = 'varsity' WHERE role = 'player' AND (team IS NULL OR team NOT IN (" + TEAMS.map(t => "'" + t + "'").join(", ") + "))").run();
      schemaReady = true;
    }
    const segs = (Array.isArray(params.path) ? params.path : [params.path]).filter(Boolean);
    const method = request.method;
    let body = null;
    if (method !== "GET" && method !== "HEAD") { checkOrigin(request); body = await readJson(request); }
    const user = await currentUser(db, request);
    // Work that can finish after the response is sent (push notifications).
    const later = p => { const q = Promise.resolve(p).catch(e => console.error(e && e.stack ? e.stack : e)); if (waitUntil) waitUntil(q); };
    const res = await route(db, request, method, segs, body || {}, user, later);
    // Sign-ins renew themselves: any request in the last 29 days of a session pushes it out to 30 again.
    if (user && !res.headers.has("Set-Cookie") && user.s_exp - Date.now() < (SESSION_DAYS - 1) * 864e5) {
      await db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").bind(Date.now() + SESSION_DAYS * 864e5, user.s_hash).run();
      res.headers.append("Set-Cookie", cookie(request, sessionToken(request), SESSION_DAYS * 86400));
    }
    return res;
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e && e.stack ? e.stack : e);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
}

/* ---------- Push notifications ---------- */
const PUSH_SUBJECT = "https://nebr-rl.pages.dev";
let vapidCache = null;
// The site's VAPID key pair is made once, on first use, and kept in the database (the private key never leaves the server).
async function vapidKeys(db) {
  if (vapidCache) return vapidCache;
  let row = await db.prepare("SELECT v FROM kv WHERE k = 'vapid'").first();
  if (!row) {
    await db.prepare("INSERT OR IGNORE INTO kv (k, v) VALUES ('vapid', ?)").bind(JSON.stringify(await generateVapid())).run();
    row = await db.prepare("SELECT v FROM kv WHERE k = 'vapid'").first();
  }
  vapidCache = JSON.parse(row.v);
  return vapidCache;
}
const clip = (t, n) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "\u2026" : s; };
async function notify(db, userIds, msg) {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (!ids.length) return { sent: 0, failed: 0 };
  const { results } = await db.prepare("SELECT * FROM push_subs WHERE user_id IN (" + ids.map(() => "?").join(", ") + ")").bind(...ids).all();
  if (!results.length) return { sent: 0, failed: 0 };
  const keys = await vapidKeys(db), payload = JSON.stringify(msg), gone = [];
  let sent = 0, failed = 0;
  await Promise.all(results.map(async sub => {
    try {
      const r = await sendPush(sub, payload, keys, PUSH_SUBJECT);
      if (r.ok) sent++;
      else { failed++; if (r.status === 404 || r.status === 410) gone.push(sub.endpoint); else console.error("push " + r.status + " " + new URL(sub.endpoint).hostname + " " + (await r.text()).slice(0, 200)); }
    } catch (e) { failed++; console.error(e && e.stack ? e.stack : e); }
  }));
  // The browser dropped these subscriptions (uninstalled, permission removed): forget them.
  if (gone.length) await db.batch(gone.map(ep => db.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(ep)));
  return { sent, failed };
}
async function coachIds(db, except) {
  const { results } = await db.prepare("SELECT id FROM users WHERE role = 'coach'").all();
  return results.map(r => r.id).filter(id => id !== except);
}

/* ---------- Schedule: scrims and matches, each for one or more rosters ---------- */
const EVENT_KINDS = { scrim: "Scrim", match: "Match" };
const RSVP = ["in", "maybe", "out"];
const SCHED_PAST_MS = 45 * 864e5;
function normEvent(b) {
  const kind = EVENT_KINDS[b.kind] ? b.kind : "scrim";
  const opponent = cleanText(b.opponent, 60).replace(/\s+/g, " ").trim();
  if (!opponent) fail(400, "Enter the opponent (or TBD).");
  const at = Date.parse(String(b.startsAt || ""));
  if (!Number.isFinite(at) || Math.abs(at - Date.now()) > 730 * 864e5) fail(400, "Pick a date and time.");
  const teams = TEAMS.filter(t => Array.isArray(b.teams) && b.teams.includes(t));
  if (!teams.length) fail(400, "Pick at least one roster.");
  const rawLink = String(b.link || "").trim().slice(0, 300);
  let link = "";
  if (rawLink) {
    try { const u = new URL(/^https?:\/\//i.test(rawLink) ? rawLink : "https://" + rawLink); if (!/^https?:$/.test(u.protocol)) throw 0; link = u.toString(); }
    catch (_) { fail(400, "That link doesn't look right."); }
  }
  return { kind, opponent, startsAt: at, format: cleanText(b.format, 40).trim(), details: cleanText(b.details, 1000).trim(), link, teams, result: cleanText(b.result, 40).trim() };
}
function pubEvent(r, rs, me) {
  const mine = rs.filter(x => x.event_id === r.id);
  const out = {
    id: r.id, kind: r.kind, opponent: r.opponent, startsAt: new Date(r.starts_at).toISOString(), format: r.format || "", details: r.details || "",
    link: r.link || "", teams: parse(r.teams, []), result: r.result || "",
    rsvps: mine.map(x => ({ userId: x.user_id, name: x.username, status: x.status }))
  };
  if (me) { const m = mine.find(x => x.user_id === me); out.mine = m ? m.status : ""; }
  return out;
}
async function eventsWithRsvps(db, rows, me) {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const { results } = await db.prepare("SELECT r.event_id, r.user_id, r.status, u.username FROM rsvps r JOIN users u ON u.id = r.user_id WHERE r.event_id IN (" + ids.map(() => "?").join(", ") + ") ORDER BY r.at").bind(...ids).all();
  return rows.map(r => pubEvent(r, results, me));
}
const fmtWhen = ms => new Date(ms).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
// Players who can see an event: on one of its rosters, and that roster can see the Schedule.
async function eventAudience(db, teams) {
  const st = await getSettings(db), ok = teams.filter(t => st.schedTeams.includes(t));
  if (!ok.length) return [];
  const { results } = await db.prepare("SELECT id FROM users WHERE role = 'player' AND team IN (" + ok.map(() => "?").join(", ") + ")").bind(...ok).all();
  return results.map(r => r.id);
}
const canSeeSched = (u, st) => u.role === "player" && st.schedTeams.includes(u.team);

async function route(db, req, method, segs, body, user, later) {
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
    // Signing off a device also stops its notifications.
    if (user && body.endpoint) await db.prepare("DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?").bind(String(body.endpoint), user.id).run();
    return json({ ok: true }, 200, { "Set-Cookie": cookie(req, "", 0) });
  }

  if (!user) fail(401, "Signed out. Sign on again.");

  /* ----- signed-in user ----- */
  if (key === "GET me") return json({ me: pub(user) });
  if (key === "PATCH me") {
    const sets = [], vals = [];
    if ("active" in body) { sets.push("active = ?"); vals.push(JSON.stringify(normActive(body.active))); }
    if ("customFocus" in body) { sets.push("custom_focus = ?"); vals.push(JSON.stringify(normFocus(body.customFocus))); }
    if ("prefs" in body) { sets.push("prefs = ?"); vals.push(JSON.stringify(normPrefs(body.prefs))); }
    if (sets.length) await db.prepare("UPDATE users SET " + sets.join(", ") + " WHERE id = ?").bind(...vals, user.id).run();
    const u = await db.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first();
    return json({ me: pub(u) });
  }
  /* Schedule (players see their roster's events; the coach uses coach/events) */
  if (key === "GET events") {
    const st = await getSettings(db);
    if (!canSeeSched(user, st)) return json({ access: false, events: [] });
    const { results } = await db.prepare("SELECT * FROM events WHERE starts_at >= ? ORDER BY starts_at LIMIT 300").bind(Date.now() - SCHED_PAST_MS).all();
    const rows = results.filter(r => parse(r.teams, []).includes(user.team));
    return json({ access: true, events: await eventsWithRsvps(db, rows, user.id) });
  }
  if (a === "events" && b && c === "rsvp" && method === "PUT") {
    const st = await getSettings(db);
    const ev = await db.prepare("SELECT * FROM events WHERE id = ?").bind(b).first();
    if (!ev || !canSeeSched(user, st) || !parse(ev.teams, []).includes(user.team)) fail(404, "That event isn't on your schedule.");
    if (ev.starts_at < Date.now() - 6 * 3600e3) fail(400, "That one already happened.");
    const status = RSVP.includes(body.status) ? body.status : "";
    if (status) await db.prepare("INSERT INTO rsvps (event_id, user_id, status, at) VALUES (?, ?, ?, ?) ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status, at = excluded.at").bind(b, user.id, status, Date.now()).run();
    else await db.prepare("DELETE FROM rsvps WHERE event_id = ? AND user_id = ?").bind(b, user.id).run();
    return json({ ok: true, status });
  }
  /* Push notifications for this device */
  if (key === "GET push/key") return json({ key: (await vapidKeys(db)).publicKey });
  if (key === "POST push/subscribe") {
    const ep = String(body.endpoint || ""), k = isPlain(body.keys) ? body.keys : {};
    const p256dh = String(k.p256dh || ""), auth = String(k.auth || "");
    if (!isPushEndpoint(ep) || ep.length > 1000 || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,40}$/.test(auth)) fail(400, "This browser's notification setup wasn't accepted.");
    try { await crypto.subtle.importKey("raw", unb64url(p256dh), { name: "ECDH", namedCurve: "P-256" }, false, []); }
    catch (_) { fail(400, "This browser's notification setup wasn't accepted."); }
    await db.prepare("INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth").bind(ep, user.id, p256dh, auth, Date.now()).run();
    // Keep the newest 10 devices per person.
    await db.prepare("DELETE FROM push_subs WHERE user_id = ? AND endpoint NOT IN (SELECT endpoint FROM push_subs WHERE user_id = ? ORDER BY created_at DESC LIMIT 10)").bind(user.id, user.id).run();
    return json({ ok: true });
  }
  if (key === "POST push/unsubscribe") {
    await db.prepare("DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?").bind(String(body.endpoint || ""), user.id).run();
    return json({ ok: true });
  }
  if (key === "POST push/test") {
    const r = await notify(db, [user.id], { title: "Notifications are on", body: "You'll get Coach notes and replay reviews here.", url: "/", tag: "test" });
    return json(r);
  }
  /* Replay review requests: a player asks the coach to look at a Ranked Session. */
  if (key === "GET reviews") {
    const { results } = await db.prepare("SELECT * FROM reviews WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").bind(user.id).all();
    return json({ reviews: results.map(pubReview) });
  }
  if (key === "POST reviews") {
    const wk = weekId(body.week), sid = String(body.sessionId || "");
    const row = await db.prepare("SELECT data FROM weeks WHERE user_id = ? AND week = ?").bind(user.id, wk).first();
    const ses = (row ? parse(row.data, {}).sessions || [] : []).find(x => isPlain(x) && x.id === sid);
    if (!ses) fail(404, "That session isn't saved yet. Try again in a moment.");
    if (ses.type !== "ranked") fail(400, "Replay reviews are for Ranked Sessions.");
    const note = cleanText(body.note, 1000).trim();
    if (!note) fail(400, "Say what Coach should look at.");
    const rawLink = String(body.link || "").trim().slice(0, 300);
    let link = "";
    if (rawLink) {
      try { const u = new URL(/^https?:\/\//i.test(rawLink) ? rawLink : "https://" + rawLink); if (!/^https?:$/.test(u.protocol)) throw 0; link = u.toString(); }
      catch (_) { fail(400, "That replay link doesn't look right."); }
    }
    const playlist = REVIEW_PL.includes(body.playlist) ? body.playlist : "";
    const open = await db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE user_id = ? AND status = 'open'").bind(user.id).first();
    if (open && open.n >= 20) fail(429, "You have 20 requests waiting. Wait for Coach to get to some first.");
    const id = newId(), now = Date.now();
    await db.prepare("INSERT INTO reviews (id, user_id, week, session_id, playlist, link, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)").bind(id, user.id, wk, sid, playlist, link, note, now).run();
    later(coachIds(db, user.id).then(ids => notify(db, ids, { title: "Replay review request", body: user.username + ": " + clip(note, 140), url: "/?go=reviews", tag: "rv-" + id })));
    return json({ review: pubReview({ id, user_id: user.id, week: wk, session_id: sid, playlist, link, note, status: "open", created_at: now }) });
  }
  if (method === "DELETE" && a === "reviews" && b && !c) {
    await db.prepare("DELETE FROM reviews WHERE id = ? AND user_id = ? AND status = 'open'").bind(b, user.id).run();
    return json({ ok: true });
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
  if (key === "GET ranks/history") return json({ history: await readHistory(db, user.id) });
  if (method === "GET" && a === "leaderboard" && b && !c) {
    // Ranked games logged this week, per player. Names and counts only.
    const wk = weekId(b);
    const { results } = await db.prepare("SELECT u.username AS name, w.data AS data FROM users u LEFT JOIN weeks w ON w.user_id = u.id AND w.week = ? WHERE u.role IN ('player', 'coach')").bind(wk).all();
    const rows = results.map(r => {
      const d = parse(r.data, {});
      let games = 0;
      for (const s of Array.isArray(d.sessions) ? d.sessions : []) {
        if (!isPlain(s) || !isPlain(s.games)) continue;
        for (const p of PL) { const g = s.games[p]; if (isPlain(g)) games += (Number(g.w) || 0) + (Number(g.l) || 0); }
      }
      return { name: r.name, games };
    }).sort((x, y) => y.games - x.games || x.name.localeCompare(y.name, "en", { sensitivity: "base" }));
    return json({ week: wk, rows });
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

    if (key === "GET coach/players" && !c) {
      const { results } = await db.prepare("SELECT * FROM users ORDER BY username COLLATE NOCASE").all();
      return json({ players: results.map(pub) });
    }
    if (key === "POST coach/players" && !c) {
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
    if (b === "players" && c && segs[3] === "sessions" && segs[6] === "note" && method === "PUT") {
      const wk = weekId(segs[4]), sid = segs[5];
      const row = await db.prepare("SELECT data FROM weeks WHERE user_id = ? AND week = ?").bind(c, wk).first();
      const d = row ? parse(row.data, {}) : {};
      const s = (Array.isArray(d.sessions) ? d.sessions : []).find(x => isPlain(x) && x.id === sid);
      if (!s) fail(404, "That session no longer exists.");
      if (!s.endedAt) fail(400, "Notes can be added once the session is checked out.");
      // eslint-disable-next-line no-control-regex
      const note = String(body.note == null ? "" : body.note).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, 1000);
      const before = s.coachNote || "";
      if (note) { s.coachNote = note; s.coachNoteAt = new Date().toISOString(); } else { delete s.coachNote; delete s.coachNoteAt; }
      await db.prepare("UPDATE weeks SET data = ?, updated_at = ? WHERE user_id = ? AND week = ?").bind(JSON.stringify(d), Date.now(), c, wk).run();
      if (note && note !== before && c !== user.id) later(notify(db, [c], { title: "Coach left a note", body: clip(note, 160), url: "/?go=week&wk=" + wk, tag: "note-" + sid }));
      return json({ ok: true, note });
    }
    if (b === "players" && c && segs[3] === "sessions" && segs[5] && !segs[6] && method === "PUT") {
      const wk = weekId(segs[4]), sid = segs[5];
      const row = await db.prepare("SELECT data FROM weeks WHERE user_id = ? AND week = ?").bind(c, wk).first();
      const d = row ? parse(row.data, {}) : {};
      const list = Array.isArray(d.sessions) ? d.sessions : [];
      const s = list.find(x => isPlain(x) && x.id === sid);
      if (!s) fail(404, "That session no longer exists.");
      if (!s.endedAt) fail(400, "Sessions can be edited once they're checked out.");
      applyCoachEdit(s, body.session, wk, Date.now());
      list.sort((x, y) => String(x.startedAt).localeCompare(String(y.startedAt)));
      await db.prepare("UPDATE weeks SET data = ?, updated_at = ? WHERE user_id = ? AND week = ?").bind(JSON.stringify(d), Date.now(), c, wk).run();
      return json({ ok: true, session: s });
    }
    if (b === "players" && c && segs[3] === "weeks" && method === "GET") {
      const { results } = await db.prepare("SELECT week, data FROM weeks WHERE user_id = ? ORDER BY week DESC LIMIT 80").bind(c).all();
      return json({ weeks: results.map(r => ({ week: r.week, data: parse(r.data, {}) })) });
    }
    if (b === "players" && c && segs[3] === "history" && method === "GET") {
      return json({ history: await readHistory(db, c) });
    }
    if (b === "players" && c && (method === "PATCH" || method === "DELETE")) {
      const target = await db.prepare("SELECT * FROM users WHERE id = ?").bind(c).first();
      if (!target) fail(404, "That player no longer exists.");
      if (method === "DELETE") {
        if (target.role === "coach") fail(400, "The coach account can't be removed.");
        await db.batch([
          db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(c),
          db.prepare("DELETE FROM weeks WHERE user_id = ?").bind(c),
          db.prepare("DELETE FROM rank_history WHERE user_id = ?").bind(c),
          db.prepare("DELETE FROM reviews WHERE user_id = ?").bind(c),
          db.prepare("DELETE FROM push_subs WHERE user_id = ?").bind(c),
          db.prepare("DELETE FROM rsvps WHERE user_id = ?").bind(c),
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
        if (!TEAMS.includes(body.team)) fail(400, "Pick Varsity, White, Black, or Casual.");
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
      if ("targets" in body) {
        if (target.role === "coach") fail(400, "The coach doesn't have a weekly requirement.");
        const t = isPlain(body.targets) ? body.targets : {};
        const own = v => (v === null || v === undefined || v === "" ? null : intIn(v, 14));
        const log = logPut(normPlayerLog(parse(target.targets, [])), { from: weekFrom(body.from), ranked: own(t.ranked), training: own(t.training) }, { from: LOG_START, ranked: null, training: null });
        sets.push("targets = ?"); vals.push(JSON.stringify(log));
      }
      let newRanks = null;
      if ("ranks" in body) { newRanks = applyRanks(parse(target.ranks, {}), body.ranks, false); sets.push("ranks = ?"); vals.push(JSON.stringify(newRanks)); }
      if (sets.length) await db.batch([db.prepare("UPDATE users SET " + sets.join(", ") + " WHERE id = ?").bind(...vals, c)].concat(extra));
      if (newRanks) await recordHistory(db, c, newRanks);
      const u = await db.prepare("SELECT * FROM users WHERE id = ?").bind(c).first();
      return json({ player: pub(u) });
    }
    if (key === "GET coach/weeks" && c) {
      const wk = weekId(c);
      const { results } = await db.prepare("SELECT user_id, data FROM weeks WHERE week = ?").bind(wk).all();
      return json({ week: wk, weeks: results.map(r => ({ userId: r.user_id, data: parse(r.data, {}) })) });
    }
    if (key === "PUT coach/settings") {
      const prev = await getSettings(db);
      const s = normSettings(body.settings);
      s.targetsLog = prev.targetsLog;
      const keys = ["ranked", "training", "minGames", "minMinutes"];
      if (keys.some(k => s.targets[k] !== prev.targets[k])) {
        s.targetsLog = logPut(prev.targetsLog, Object.assign({ from: weekFrom(body.from) }, s.targets), Object.assign({ from: LOG_START }, prev.targets));
      }
      await db.prepare("INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data").bind(JSON.stringify(s)).run();
      return json({ settings: s });
    }
    if (key === "GET coach/events") {
      const { results } = await db.prepare("SELECT * FROM events WHERE starts_at >= ? ORDER BY starts_at LIMIT 300").bind(Date.now() - SCHED_PAST_MS).all();
      return json({ events: await eventsWithRsvps(db, results, null) });
    }
    if (key === "POST coach/events") {
      const e = normEvent(body), id = newId(), now = Date.now();
      await db.prepare("INSERT INTO events (id, kind, opponent, starts_at, format, details, link, teams, result, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, e.kind, e.opponent, e.startsAt, e.format, e.details, e.link, JSON.stringify(e.teams), e.result, now, now).run();
      if (e.startsAt > now) later(eventAudience(db, e.teams).then(ids => notify(db, ids, { title: "New " + EVENT_KINDS[e.kind].toLowerCase() + ": vs " + e.opponent, body: fmtWhen(e.startsAt) + (e.format ? " \u00b7 " + e.format : ""), url: "/?go=schedule", tag: "ev-" + id })));
      const row = await db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
      return json({ event: pubEvent(row, [], null) });
    }
    if (b === "events" && c && method === "PUT") {
      const prev = await db.prepare("SELECT * FROM events WHERE id = ?").bind(c).first();
      if (!prev) fail(404, "That event no longer exists.");
      const e = normEvent(body);
      await db.prepare("UPDATE events SET kind = ?, opponent = ?, starts_at = ?, format = ?, details = ?, link = ?, teams = ?, result = ?, updated_at = ? WHERE id = ?")
        .bind(e.kind, e.opponent, e.startsAt, e.format, e.details, e.link, JSON.stringify(e.teams), e.result, Date.now(), c).run();
      // Only a new time is worth a notification (and only for events still ahead).
      if (e.startsAt !== prev.starts_at && e.startsAt > Date.now()) later(eventAudience(db, e.teams).then(ids => notify(db, ids, { title: EVENT_KINDS[e.kind] + " moved: vs " + e.opponent, body: "Now " + fmtWhen(e.startsAt), url: "/?go=schedule", tag: "ev-" + c })));
      const row = await db.prepare("SELECT * FROM events WHERE id = ?").bind(c).first();
      return json({ event: (await eventsWithRsvps(db, [row], null))[0] });
    }
    if (b === "events" && c && method === "DELETE") {
      const prev = await db.prepare("SELECT * FROM events WHERE id = ?").bind(c).first();
      await db.batch([db.prepare("DELETE FROM rsvps WHERE event_id = ?").bind(c), db.prepare("DELETE FROM events WHERE id = ?").bind(c)]);
      if (prev && prev.starts_at > Date.now()) later(eventAudience(db, parse(prev.teams, [])).then(ids => notify(db, ids, { title: EVENT_KINDS[prev.kind] + " canceled: vs " + prev.opponent, body: "Was " + fmtWhen(prev.starts_at), url: "/?go=schedule", tag: "ev-" + c })));
      return json({ ok: true });
    }
    if (key === "GET coach/reviews") {
      const { results } = await db.prepare("SELECT r.*, u.username FROM reviews r JOIN users u ON u.id = r.user_id ORDER BY (r.status = 'open') DESC, r.created_at DESC LIMIT 200").all();
      return json({ reviews: results.map(pubReview) });
    }
    if (b === "reviews" && c && method === "PATCH") {
      const status = body.status === "done" ? "done" : "open";
      const prev = await db.prepare("SELECT user_id, status, playlist FROM reviews WHERE id = ?").bind(c).first();
      await db.prepare("UPDATE reviews SET status = ?, done_at = ? WHERE id = ?").bind(status, status === "done" ? Date.now() : null, c).run();
      if (prev && prev.status !== "done" && status === "done" && prev.user_id !== user.id) {
        const pl = { duel: "1v1 Duel", doubles: "2v2 Doubles", standard: "3v3 Standard" }[prev.playlist];
        later(notify(db, [prev.user_id], { title: "Replay reviewed", body: "Coach went over your " + (pl ? pl + " " : "") + "replay.", url: "/?go=week", tag: "rvd-" + c }));
      }
      return json({ ok: true, status });
    }
    if (b === "reviews" && c && method === "DELETE") {
      await db.prepare("DELETE FROM reviews WHERE id = ?").bind(c).run();
      return json({ ok: true });
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
        const next = applyRanks(parse(row.ranks, {}), up.playlists, true);
        await db.prepare("UPDATE users SET ranks = ? WHERE id = ?").bind(JSON.stringify(next), up.id).run();
        await recordHistory(db, up.id, next);
        saved++;
      }
      return json({ saved });
    }
  }

  fail(404, "Not found.");
}
