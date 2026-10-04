import { generateVapid, sendPush, isPushEndpoint, unb64url } from "../../lib/webpush.js";
/*
 * Backpost API: every /api/* request. Cloudflare Pages Function with a D1 database bound as DB.
 *
 *   /api/s/<school>/...   one school's app (players and coaches of that school only)
 *   /api/admin/...        the platform admin (Gage): schools, invites, access requests
 *   /api/join/<token>     a coach accepting an invite
 *   /api/public/...       the landing page's "request access" form
 *   /api/...              on the old Nebraska address (nebr-rl.pages.dev), the Nebraska school
 *
 * Every school query is filtered by school_id. Sign-ins are per school: the session cookie's path is that
 * school's API, so a browser never sends one school's sign-in to another school.
 * Tables are created (and older Nebraska data moved in) automatically on first use.
 */

const SESSION_DAYS = 30;
const PW_ITER = 25000;
const MAX_BODY = 256 * 1024;
const MAX_ASSET_BODY = 1200 * 1024;
const LOCK_AFTER = 8;
const LOCK_MS = 10 * 60 * 1000;
const LEGACY_SCHOOL = "nebraska";
const LEGACY_HOSTS = ["nebr-rl.pages.dev"];
const SCHEMA_VERSION = "2";

const PL = ["duel", "doubles", "standard"];
const TIER_BASES = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Champion", "Grand Champion"];
const TIERS = ["Unranked"].concat(TIER_BASES.flatMap(t => [t + " I", t + " II", t + " III"]), ["Supersonic Legend"]);
const DIVS = ["Div I", "Div II", "Div III", "Div IV"];
const TYPES = ["ranked", "training"];
const RESERVED = new Set(["admin", "join", "api", "s", "public", "app", "www", "static", "assets", "fonts", "icons", "brand", "bp", "login", "signup", "help", "about", "privacy", "terms", "backpost", "new", "settings", "index", "manifest", "sw", "favicon"]);

/* ---------- Themes ---------- */
const PAPERS = ["clean", "cream", "white"];
const FONTS = ["arena", "classic", "block"];
const SHAPES = ["angled", "rounded"];
const HEADERS = ["color", "light"];
const BACKPOST_THEME = { primary: "#4289d1", secondary: "#ed8727", paper: "clean", fonts: "arena", shape: "angled", header: "color" };
const NEBRASKA_THEME = { primary: "#d00000", secondary: "", paper: "cream", fonts: "classic", shape: "rounded", header: "color" };
const DEFAULT_ROSTERS = [{ id: "varsity", name: "Varsity", casual: false }, { id: "jv", name: "JV", casual: false }, { id: "casual", name: "Casual", casual: true }];
const NEBRASKA_ROSTERS = [{ id: "varsity", name: "Varsity", casual: false }, { id: "white", name: "White", casual: false }, { id: "black", name: "Black", casual: false }, { id: "casual", name: "Casual", casual: true }];
const FEATURES = ["reviews", "schedule", "ranks", "board"];

const DEFAULT_SETTINGS = {
  title: "",
  targets: { ranked: 3, training: 2, minGames: 5, minMinutes: 30 },
  rankedGoals: { duel: { min: 5, max: 10 }, doubles: { min: 15, max: 20 }, standard: { min: null, max: null } },
  targetsLog: [],
  rosters: DEFAULT_ROSTERS,
  schedRosters: null,
  features: { reviews: true, schedule: true, ranks: true, board: true },
  theme: BACKPOST_THEME,
  logo: "",
  icon: "",
  tz: "America/Chicago"
};

/* Tables, in their current shape. Indexes come after the migration, since some use columns it adds. */
const TABLES = [
  `CREATE TABLE IF NOT EXISTS schools (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'active',
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS school_settings (school_id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS school_assets (
     school_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     mime TEXT NOT NULL,
     data TEXT NOT NULL,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (school_id, kind)
   )`,
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     school_id TEXT NOT NULL,
     username TEXT NOT NULL COLLATE NOCASE,
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
  `CREATE TABLE IF NOT EXISTS weeks (
     user_id TEXT NOT NULL,
     school_id TEXT,
     week TEXT NOT NULL,
     data TEXT NOT NULL,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, week)
   )`,
  `CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rank_history (
     user_id TEXT NOT NULL,
     at INTEGER NOT NULL,
     duel INTEGER,
     doubles INTEGER,
     standard INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS reviews (
     id TEXT PRIMARY KEY,
     school_id TEXT,
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
  `CREATE TABLE IF NOT EXISTS push_subs (
     endpoint TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     p256dh TEXT NOT NULL,
     auth TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS events (
     id TEXT PRIMARY KEY,
     school_id TEXT,
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
  `CREATE TABLE IF NOT EXISTS rsvps (
     event_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     status TEXT NOT NULL,
     at INTEGER NOT NULL,
     PRIMARY KEY (event_id, user_id)
   )`,
  `CREATE TABLE IF NOT EXISTS admins (
     id TEXT PRIMARY KEY,
     username TEXT NOT NULL UNIQUE COLLATE NOCASE,
     pw_hash TEXT NOT NULL,
     fail_count INTEGER NOT NULL DEFAULT 0,
     locked_until INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (
     token_hash TEXT PRIMARY KEY,
     admin_id TEXT NOT NULL,
     expires_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS invites (
     id TEXT PRIMARY KEY,
     token_hash TEXT NOT NULL UNIQUE,
     school_id TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     used_at INTEGER,
     used_by TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS access_requests (
     id TEXT PRIMARY KEY,
     school TEXT NOT NULL,
     name TEXT NOT NULL,
     email TEXT NOT NULL,
     role TEXT,
     message TEXT,
     ip_hash TEXT,
     status TEXT NOT NULL DEFAULT 'new',
     created_at INTEGER NOT NULL
   )`
];
const INDEXES = [
  `CREATE UNIQUE INDEX IF NOT EXISTS users_school_name ON users(school_id, username COLLATE NOCASE)`,
  `CREATE INDEX IF NOT EXISTS users_school_role ON users(school_id, role)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS weeks_school_week ON weeks(school_id, week)`,
  `CREATE INDEX IF NOT EXISTS rank_history_user ON rank_history(user_id, at)`,
  `CREATE INDEX IF NOT EXISTS reviews_user ON reviews(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS reviews_school ON reviews(school_id, status, created_at)`,
  `CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs(user_id)`,
  `CREATE INDEX IF NOT EXISTS events_school_start ON events(school_id, starts_at)`,
  `CREATE INDEX IF NOT EXISTS invites_school ON invites(school_id)`,
  `CREATE INDEX IF NOT EXISTS access_requests_time ON access_requests(created_at)`
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
function cleanText(v, max) {
  // eslint-disable-next-line no-control-regex
  return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, max);
}
function trackerUrl(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?(?:rocketleague\.tracker\.network|tracker\.gg)\/rocket-league\/profile\/([^/?#\s]+)\/([^/?#\s]+)/i);
  return m ? "https://rocketleague.tracker.network/rocket-league/profile/" + m[1] + "/" + m[2] + "/overview" : "";
}
function webLink(raw, what) {
  const s = String(raw || "").trim().slice(0, 300);
  if (!s) return "";
  try { const u = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s); if (!/^https?:$/.test(u.protocol)) throw 0; return u.toString(); }
  catch (_) { fail(400, "That " + what + " doesn't look right."); }
}
function b64(buf) { let s = ""; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s); }
function unb64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
function hex(buf) { return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join(""); }
async function sha256hex(s) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
function newId() { return hex(crypto.getRandomValues(new Uint8Array(12))); }
const isSlug = v => typeof v === "string" && /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(v) && v.length >= 2 && !RESERVED.has(v);
const slugify = v => String(v || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "");
const isHex = v => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

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
/* A cookie jar describes where a sign-in lives: its cookie name and the path it's sent to. */
function readCookie(req, name) {
  const m = (req.headers.get("Cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([a-f0-9]{64})"));
  return m ? m[1] : null;
}
function setCookie(req, jar, token, maxAge) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return jar.name + "=" + token + "; Path=" + jar.path + "; HttpOnly; SameSite=Lax; Max-Age=" + maxAge + secure;
}
async function newToken() { const t = hex(crypto.getRandomValues(new Uint8Array(32))); return { token: t, hash: await sha256hex(t) }; }
async function startSession(db, req, jar, userId) {
  const { token, hash } = await newToken();
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(hash, userId, now + SESSION_DAYS * 864e5)
  ]);
  return setCookie(req, jar, token, SESSION_DAYS * 86400);
}
async function currentUser(db, req, jar, school) {
  const t = readCookie(req, jar.name);
  if (!t) return null;
  const row = await db.prepare("SELECT u.*, s.expires_at AS s_exp, s.token_hash AS s_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?").bind(await sha256hex(t)).first();
  // A sign-in only counts at its own school.
  if (!row || row.s_exp < Date.now() || row.school_id !== school.id) return null;
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
function normTheme(t, base) {
  const b = base || BACKPOST_THEME, x = isPlain(t) ? t : {};
  return {
    primary: isHex(x.primary) ? x.primary.toLowerCase() : b.primary,
    secondary: x.secondary === "" ? "" : isHex(x.secondary) ? x.secondary.toLowerCase() : b.secondary,
    paper: PAPERS.includes(x.paper) ? x.paper : b.paper,
    fonts: FONTS.includes(x.fonts) ? x.fonts : b.fonts,
    shape: SHAPES.includes(x.shape) ? x.shape : b.shape,
    header: HEADERS.includes(x.header) ? x.header : b.header
  };
}
function normRosters(list) {
  const out = [];
  for (const r of Array.isArray(list) ? list : []) {
    if (!isPlain(r)) continue;
    const name = cleanName(r.name).slice(0, 20);
    if (!name) continue;
    let id = typeof r.id === "string" && /^[a-z0-9-]{1,16}$/.test(r.id) ? r.id : (slugify(name).slice(0, 16) || "roster");
    let n = 2;
    while (out.some(o => o.id === id)) id = id.slice(0, 13) + "-" + n++;
    out.push({ id, name, casual: !!r.casual });
    if (out.length >= 8) break;
  }
  return out;
}
const isValidTz = tz => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch (_) { return false; } };
// Logos are either built in (/brand/, /icons/) or uploaded to this school's asset route.
function assetPath(v, slug) {
  const s = String(v || "");
  if (/^\/(brand|icons|bp)\/[A-Za-z0-9/_-]+\.(svg|png)$/.test(s)) return s;
  if (slug && new RegExp("^/api/s/" + slug + "/asset/(logo|icon)\\?v=\\d{1,16}$").test(s)) return s;
  return "";
}
function normSettings(raw, school) {
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  s.title = school ? school.name : "";
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
  const rosters = normRosters(raw.rosters);
  if (rosters.length) s.rosters = rosters;
  const ids = s.rosters.map(r => r.id);
  // Which rosters see the Schedule (default: every roster that isn't casual).
  s.schedRosters = Array.isArray(raw.schedRosters) ? ids.filter(id => raw.schedRosters.includes(id)) : s.rosters.filter(r => !r.casual).map(r => r.id);
  if (isPlain(raw.features)) for (const f of FEATURES) s.features[f] = raw.features[f] !== false;
  s.theme = normTheme(raw.theme);
  const slug = school ? school.id : "";
  s.logo = assetPath(raw.logo, slug);
  s.icon = assetPath(raw.icon, slug);
  if (typeof raw.tz === "string" && isValidTz(raw.tz)) s.tz = raw.tz;
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
    team: u.role === "player" ? u.team || null : null,
    trackerUrl: u.tracker_url || "",
    ranks: normRanks(parse(u.ranks, {})),
    active: parse(u.active, null),
    customFocus: parse(u.custom_focus, []),
    targetsLog: normPlayerLog(parse(u.targets, [])),
    prefs: normPrefs(parse(u.prefs, {})),
    createdAt: u.created_at,
    ...(u.admin ? { admin: true } : {})
  };
}
async function getSettings(db, school) {
  const row = await db.prepare("SELECT data FROM school_settings WHERE school_id = ?").bind(school.id).first();
  return normSettings(row ? parse(row.data, null) : null, school);
}
async function putSettings(db, school, s) {
  await db.prepare("INSERT INTO school_settings (school_id, data) VALUES (?, ?) ON CONFLICT(school_id) DO UPDATE SET data = excluded.data").bind(school.id, JSON.stringify(s)).run();
}
function publicSettings(s) {
  // What a signed-out visitor needs to draw the sign-in page.
  return { title: s.title, theme: s.theme, logo: s.logo, icon: s.icon };
}
async function nameTaken(db, school, name, exceptId) {
  const row = await db.prepare("SELECT id FROM users WHERE school_id = ? AND username = ? COLLATE NOCASE").bind(school.id, name).first();
  return !!row && row.id !== exceptId;
}
// Any member of this school by id (never another school's).
async function member(db, school, id) {
  return db.prepare("SELECT * FROM users WHERE id = ? AND school_id = ?").bind(String(id || ""), school.id).first();
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
async function readJson(req, max) {
  const len = Number(req.headers.get("Content-Length") || 0);
  if (len > max) fail(413, "That's too much to save at once.");
  const text = await req.text();
  if (text.length > max) fail(413, "That's too much to save at once.");
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

/* ---------- Schema + moving the original Nebraska data in ---------- */
async function columns(db, table) {
  const r = await db.prepare("PRAGMA table_info(" + table + ")").all();
  return (r.results || []).map(c => c.name);
}
async function ensureSchema(db) {
  await db.batch(TABLES.map(s => db.prepare(s)));
  const ver = await db.prepare("SELECT v FROM kv WHERE k = 'schema'").first();
  if (!ver || ver.v !== SCHEMA_VERSION) await migrateV2(db);
  await db.batch(INDEXES.map(s => db.prepare(s)));
}
async function migrateV2(db) {
  let userCols = await columns(db, "users");
  // Columns added over the original site's life (older databases may be missing them).
  for (const c of ["team", "targets", "prefs"]) if (!userCols.includes(c)) await db.prepare("ALTER TABLE users ADD COLUMN " + c + " TEXT").run();
  userCols = await columns(db, "users");
  if (!userCols.includes("school_id")) {
    // The original single-school database: everything in it belongs to Nebraska.
    const old = await db.prepare("SELECT data FROM settings WHERE id = 1").first();
    const oldSettings = old ? parse(old.data, {}) : {};
    const title = typeof oldSettings.title === "string" && oldSettings.title.trim() ? oldSettings.title.trim() : "Nebraska Esports";
    const teams = Array.isArray(oldSettings.schedTeams) ? oldSettings.schedTeams : ["varsity", "white", "black"];
    const s = Object.assign({}, oldSettings, {
      title, rosters: NEBRASKA_ROSTERS, schedRosters: teams, theme: NEBRASKA_THEME,
      logo: "/brand/logo-cream.svg", icon: "/icons/icon-512.png", tz: "America/Chicago"
    });
    delete s.schedTeams;
    const cols = "id, username, role, team, pw_hash, tracker_url, ranks, active, custom_focus, targets, prefs, fail_count, locked_until, created_at";
    await db.batch([
      // The program's name (the app's own title, e.g. "Rocket League", stays in its settings).
      db.prepare("INSERT OR IGNORE INTO schools (id, name, status, created_at) VALUES (?, ?, 'active', ?)").bind(LEGACY_SCHOOL, "Nebraska Esports", Date.now()),
      db.prepare("INSERT OR IGNORE INTO school_settings (school_id, data) VALUES (?, ?)").bind(LEGACY_SCHOOL, JSON.stringify(s)),
      db.prepare(TABLES[3].replace("IF NOT EXISTS users", "IF NOT EXISTS users_v2")),
      db.prepare("INSERT INTO users_v2 (school_id, " + cols + ") SELECT '" + LEGACY_SCHOOL + "', " + cols + " FROM users"),
      db.prepare("DROP TABLE users"),
      db.prepare("ALTER TABLE users_v2 RENAME TO users"),
      db.prepare("UPDATE users SET team = 'varsity' WHERE role = 'player' AND (team IS NULL OR team NOT IN ('varsity', 'white', 'black', 'casual'))")
    ]);
  }
  for (const t of ["weeks", "reviews", "events"]) {
    if (!(await columns(db, t)).includes("school_id")) {
      await db.prepare("ALTER TABLE " + t + " ADD COLUMN school_id TEXT").run();
      await db.prepare("UPDATE " + t + " SET school_id = ? WHERE school_id IS NULL").bind(LEGACY_SCHOOL).run();
    }
  }
  await db.prepare("INSERT INTO kv (k, v) VALUES ('schema', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(SCHEMA_VERSION).run();
}

/* ---------- Entry point ---------- */
export async function onRequest({ request, env, params, waitUntil }) {
  try {
    if (!env.DB) return json({ error: "The site's database isn't connected yet." }, 503);
    const db = env.DB;
    if (!schemaReady) { await ensureSchema(db); schemaReady = true; }
    const url = new URL(request.url);
    const segs = (Array.isArray(params.path) ? params.path : [params.path]).filter(Boolean);
    const method = request.method;
    const assetUpload = (segs[0] === "s" && segs[2] === "coach" && segs[3] === "asset") || (segs[0] === "coach" && segs[1] === "asset");
    let body = null;
    if (method !== "GET" && method !== "HEAD") { checkOrigin(request); body = await readJson(request, assetUpload ? MAX_ASSET_BODY : MAX_BODY); }
    // Work that can finish after the response is sent (push notifications).
    const later = p => { const q = Promise.resolve(p).catch(e => console.error(e && e.stack ? e.stack : e)); if (waitUntil) waitUntil(q); };
    const ctx = { db, req: request, method, body: body || {}, later, origin: url.origin, env };
    const legacyHosts = (env.LEGACY_HOSTS ? String(env.LEGACY_HOSTS).split(",") : LEGACY_HOSTS).map(h => h.trim()).filter(Boolean);

    if (segs[0] === "admin") return await adminRoute(ctx, segs.slice(1));
    if (segs[0] === "join") return await joinRoute(ctx, segs.slice(1));
    if (segs[0] === "public") return await publicRoute(ctx, segs.slice(1));
    if (segs[0] === "s") {
      if (!isSlug(segs[1] || "") && segs[1] !== LEGACY_SCHOOL) fail(404, "That school isn't on Backpost.");
      return await schoolRequest(ctx, segs[1], segs.slice(2), false);
    }
    // The original Nebraska address keeps working: /api/... there is Nebraska's API.
    if (legacyHosts.includes(url.hostname)) return await schoolRequest(ctx, LEGACY_SCHOOL, segs, true);
    fail(404, "Not found.");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e && e.stack ? e.stack : e);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
}

const schoolCache = new Map();
async function loadSchool(db, slug) {
  const hit = schoolCache.get(slug);
  if (hit && hit.at > Date.now() - 15000) return hit.school;
  const school = await db.prepare("SELECT * FROM schools WHERE id = ?").bind(slug).first();
  schoolCache.set(slug, { at: Date.now(), school });
  return school;
}
async function schoolRequest(ctx, slug, segs, legacy) {
  const { db, req } = ctx;
  const found = await loadSchool(db, slug);
  if (!found) fail(404, "That school isn't on Backpost.");
  const school = Object.assign({}, found);
  school.base = legacy ? "/" : "/" + school.id;
  const jar = legacy ? { name: "ne_s", path: "/" } : { name: "bp_s", path: "/api/s/" + school.id };
  // Public files for this school (logo, app icon, install manifest) come before the sign-in check.
  if (ctx.method === "GET" && segs[0] === "asset") return assetResponse(db, school, segs[1]);
  if (ctx.method === "GET" && segs[0] === "manifest") return manifestResponse(db, school);
  let user = await currentUser(db, req, jar, school);
  // The Backpost admin can open any school on getbackpost.com and manage it like a coach.
  if (!user && !legacy) { const adm = await currentAdmin(db, req); if (adm) user = adminAsCoach(adm, school); }
  const res = await route(Object.assign({}, ctx, { school, jar, user }), segs);
  // Sign-ins renew themselves: any request in the last 29 days of a session pushes it out to 30 again.
  if (user && !res.headers.has("Set-Cookie") && user.s_exp - Date.now() < (SESSION_DAYS - 1) * 864e5) {
    await db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").bind(Date.now() + SESSION_DAYS * 864e5, user.s_hash).run();
    res.headers.append("Set-Cookie", setCookie(req, jar, readCookie(req, jar.name), SESSION_DAYS * 86400));
  }
  return res;
}
async function assetResponse(db, school, kind) {
  if (kind !== "logo" && kind !== "icon") fail(404, "Not found.");
  const row = await db.prepare("SELECT mime, data FROM school_assets WHERE school_id = ? AND kind = ?").bind(school.id, kind).first();
  if (!row) fail(404, "Not found.");
  return new Response(unb64(row.data), { headers: { "Content-Type": row.mime, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}
async function manifestResponse(db, school) {
  const s = await getSettings(db, school);
  const paper = { clean: "#f3f5f8", cream: "#f5f1e7", white: "#ffffff" }[s.theme.paper];
  const icon = s.icon || "/bp/icon-512.png";
  const short = s.title.length > 14 ? s.title.split(" ")[0].slice(0, 14) : s.title;
  return new Response(JSON.stringify({
    name: s.title, short_name: short, start_url: school.base, scope: school.base === "/" ? "/" : school.base,
    display: "standalone", background_color: paper, theme_color: s.theme.header === "light" ? paper : s.theme.primary,
    icons: [{ src: icon, sizes: "512x512", type: "image/png", purpose: "any" }, { src: icon, sizes: "512x512", type: "image/png", purpose: "maskable" }]
  }), { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-cache" } });
}

/* ---------- Push notifications ---------- */
const PUSH_SUBJECT = "https://getbackpost.com";
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
const clip = (t, n) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
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
async function coachIds(db, school, except) {
  const { results } = await db.prepare("SELECT id FROM users WHERE school_id = ? AND role = 'coach'").bind(school.id).all();
  return results.map(r => r.id).filter(id => id !== except);
}
const goUrl = (school, q) => school.base + "?" + q;

/* ---------- Schedule: matches, scrims and film sessions, each for one or more rosters ---------- */
const EVENT_KINDS = { match: "Match", scrim: "Scrim", film: "Film session" };
const RSVP = ["in", "maybe", "out"];
const SCHED_PAST_MS = 45 * 864e5;
function normEvent(b, st) {
  const kind = EVENT_KINDS[b.kind] ? b.kind : "scrim";
  const opponent = cleanText(b.opponent, 60).replace(/\s+/g, " ").trim();
  if (!opponent) fail(400, kind === "film" ? "Say what you're reviewing." : "Enter the opponent (or TBD).");
  const at = Date.parse(String(b.startsAt || ""));
  if (!Number.isFinite(at) || Math.abs(at - Date.now()) > 730 * 864e5) fail(400, "Pick a date and time.");
  const ids = st.rosters.map(r => r.id);
  const teams = ids.filter(t => Array.isArray(b.teams) && b.teams.includes(t));
  if (!teams.length) fail(400, "Pick at least one roster.");
  const reviews = Array.isArray(b.reviews) ? b.reviews.filter(x => typeof x === "string" && /^[a-f0-9]{24}$/.test(x)).slice(0, 20) : [];
  return { kind, opponent, startsAt: at, format: cleanText(b.format, 40).trim(), details: cleanText(b.details, 1000).trim(), link: webLink(b.link, "link"), teams, result: cleanText(b.result, 40).trim(), reviews };
}
function pubEvent(r, rs, me) {
  const mine = rs.filter(x => x.event_id === r.id);
  const extra = parse(r.format, null);
  const out = {
    id: r.id, kind: r.kind, opponent: r.opponent, startsAt: new Date(r.starts_at).toISOString(),
    format: isPlain(extra) ? extra.format || "" : r.format || "", reviews: isPlain(extra) && Array.isArray(extra.reviews) ? extra.reviews : [],
    details: r.details || "", link: r.link || "", teams: parse(r.teams, []), result: r.result || "",
    rsvps: mine.map(x => ({ userId: x.user_id, name: x.username, status: x.status }))
  };
  if (me) { const m = mine.find(x => x.user_id === me); out.mine = m ? m.status : ""; }
  return out;
}
// The format column holds { format, reviews } as JSON (film sessions list the review requests they cover).
const packFormat = e => JSON.stringify({ format: e.format, reviews: e.reviews });
async function eventsWithRsvps(db, rows, me) {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const { results } = await db.prepare("SELECT r.event_id, r.user_id, r.status, u.username FROM rsvps r JOIN users u ON u.id = r.user_id WHERE r.event_id IN (" + ids.map(() => "?").join(", ") + ") ORDER BY r.at").bind(...ids).all();
  return rows.map(r => pubEvent(r, results, me));
}
const fmtWhen = (ms, tz) => new Date(ms).toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
// Players who can see an event: on one of its rosters, and that roster can see the Schedule.
async function eventAudience(db, school, st, teams) {
  const ok = teams.filter(t => st.schedRosters.includes(t));
  if (!ok.length || !st.features.schedule) return [];
  const { results } = await db.prepare("SELECT id FROM users WHERE school_id = ? AND role = 'player' AND team IN (" + ok.map(() => "?").join(", ") + ")").bind(school.id, ...ok).all();
  return results.map(r => r.id);
}
const canSeeSched = (u, st) => st.features.schedule && u.role === "player" && st.schedRosters.includes(u.team);
const eventTitle = e => e.kind === "film" ? "Film: " + e.opponent : EVENT_KINDS[e.kind] + " vs " + e.opponent;

/* ---------- One school's routes ---------- */
async function route(ctx, segs) {
  const { db, req, method, body, user, school, jar, later } = ctx;
  const [a, b, c] = segs;
  const key = method + " " + [a, b].filter(Boolean).join("/");

  /* ----- public ----- */
  if (key === "GET state") {
    const settings = await getSettings(db, school);
    const info = { slug: school.id, name: school.name, status: school.status, base: school.base };
    const isAdmin = !!(user && user.admin);
    if (school.status !== "active" && !isAdmin) return json({ school: info, me: null, settings: publicSettings(settings), paused: true });
    return json({ school: info, needsSetup: false, me: user ? pub(user) : null, settings: user ? settings : publicSettings(settings), paused: school.status !== "active" });
  }
  // A paused school is closed to its members; the admin can still manage it.
  if (school.status !== "active" && !(user && user.admin)) fail(403, "This school is paused on Backpost.");
  if (key === "POST login") {
    const name = cleanName(body.name);
    const u = name ? await db.prepare("SELECT * FROM users WHERE school_id = ? AND username = ? COLLATE NOCASE").bind(school.id, name).first() : null;
    if (!u) { await derive("x", new Uint8Array(16), PW_ITER); fail(401, "Wrong name or password."); }
    if (u.locked_until > Date.now()) fail(429, "Too many tries. Wait a few minutes.");
    if (!(await checkPw(body.password, u.pw_hash))) {
      const fails = u.fail_count + 1;
      const lock = fails >= LOCK_AFTER;
      await db.prepare("UPDATE users SET fail_count = ?, locked_until = ? WHERE id = ?").bind(lock ? 0 : fails, lock ? Date.now() + LOCK_MS : 0, u.id).run();
      fail(lock ? 429 : 401, lock ? "Too many tries. Wait a few minutes." : "Wrong name or password.");
    }
    if (u.fail_count) await db.prepare("UPDATE users SET fail_count = 0, locked_until = 0 WHERE id = ?").bind(u.id).run();
    return json({ me: pub(u) }, 200, { "Set-Cookie": await startSession(db, req, jar, u.id) });
  }
  if (key === "POST logout") {
    if (user && !user.admin) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(user.s_hash).run();
    // Signing off a device also stops its notifications.
    if (user && !user.admin && body.endpoint) await db.prepare("DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?").bind(String(body.endpoint), user.id).run();
    return json({ ok: true }, 200, { "Set-Cookie": setCookie(req, jar, "", 0) });
  }

  if (!user) fail(401, "Signed out. Sign in again.");
  const st = await getSettings(db, school);
  // Notifications carry the school's own app icon.
  const notifyS = (ids, msg) => notify(db, ids, Object.assign({ icon: st.icon || "" }, msg));

  // The admin has no training, schedule answers, reviews or notifications of their own here.
  if (user.admin && a !== "coach") {
    if (key === "GET me" || key === "PATCH me") return json({ me: pub(user) });
    if (key === "GET weeks") return json({ weeks: [] });
    if (key === "GET ranks/history") return json({ history: [] });
    if (key === "GET reviews") return json({ reviews: [] });
    if (key === "GET events") return json({ access: false, events: [] });
    if (key !== "GET push/key" && !(method === "GET" && a === "leaderboard")) fail(403, "You're managing this team as the Backpost admin. This part is for team members.");
  }

  /* ----- signed-in member ----- */
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
  /* Schedule (players see their roster's events; coaches use coach/events) */
  if (key === "GET events") {
    if (!canSeeSched(user, st)) return json({ access: false, events: [] });
    const { results } = await db.prepare("SELECT * FROM events WHERE school_id = ? AND starts_at >= ? ORDER BY starts_at LIMIT 300").bind(school.id, Date.now() - SCHED_PAST_MS).all();
    const rows = results.filter(r => parse(r.teams, []).includes(user.team));
    return json({ access: true, events: await eventsWithRsvps(db, rows, user.id) });
  }
  if (a === "events" && b && c === "rsvp" && method === "PUT") {
    const ev = await db.prepare("SELECT * FROM events WHERE id = ? AND school_id = ?").bind(b, school.id).first();
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
    const r = await notifyS([user.id], { title: "Notifications are on", body: "You'll get updates from " + st.title + " here.", url: school.base, tag: "test" });
    return json(r);
  }
  /* Replay review requests: a player asks the coach to look at a Ranked Session. */
  if (key === "GET reviews") {
    const { results } = await db.prepare("SELECT * FROM reviews WHERE user_id = ? AND school_id = ? ORDER BY created_at DESC LIMIT 100").bind(user.id, school.id).all();
    return json({ reviews: results.map(pubReview) });
  }
  if (key === "POST reviews") {
    if (!st.features.reviews) fail(403, "Replay reviews are turned off for this team.");
    const wk = weekId(body.week), sid = String(body.sessionId || "");
    const row = await db.prepare("SELECT data FROM weeks WHERE user_id = ? AND week = ?").bind(user.id, wk).first();
    const ses = (row ? parse(row.data, {}).sessions || [] : []).find(x => isPlain(x) && x.id === sid);
    if (!ses) fail(404, "That session isn't saved yet. Try again in a moment.");
    if (ses.type !== "ranked") fail(400, "Replay reviews are for Ranked Sessions.");
    const note = cleanText(body.note, 1000).trim();
    if (!note) fail(400, "Say what Coach should look at.");
    const link = webLink(body.link, "replay link");
    const playlist = REVIEW_PL.includes(body.playlist) ? body.playlist : "";
    const open = await db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE user_id = ? AND status = 'open'").bind(user.id).first();
    if (open && open.n >= 20) fail(429, "You have 20 requests waiting. Wait for Coach to get to some first.");
    const id = newId(), now = Date.now();
    await db.prepare("INSERT INTO reviews (id, school_id, user_id, week, session_id, playlist, link, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)").bind(id, school.id, user.id, wk, sid, playlist, link, note, now).run();
    later(coachIds(db, school, user.id).then(ids => notifyS(ids, { title: "Replay review request", body: user.username + ": " + clip(note, 140), url: goUrl(school, "go=reviews"), tag: "rv-" + id })));
    return json({ review: pubReview({ id, user_id: user.id, week: wk, session_id: sid, playlist, link, note, status: "open", created_at: now }) });
  }
  if (method === "DELETE" && a === "reviews" && b && !c) {
    await db.prepare("DELETE FROM reviews WHERE id = ? AND user_id = ? AND school_id = ? AND status = 'open'").bind(b, user.id, school.id).run();
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
    // Effort this week, per member of this school: sessions finished, then ranked games. Names and counts only.
    // Coaches only show up once they've logged something themselves.
    const wk = weekId(b);
    const { results } = await db.prepare("SELECT u.username AS name, u.role AS role, w.data AS data FROM users u LEFT JOIN weeks w ON w.user_id = u.id AND w.week = ? WHERE u.school_id = ? AND u.role IN ('player', 'coach')").bind(wk, school.id).all();
    const rows = results.map(r => {
      const d = parse(r.data, {});
      let games = 0, sessions = 0;
      for (const s of Array.isArray(d.sessions) ? d.sessions : []) {
        if (!isPlain(s)) continue;
        if (s.endedAt) sessions++;
        if (!isPlain(s.games)) continue;
        for (const p of PL) { const g = s.games[p]; if (isPlain(g)) games += (Number(g.w) || 0) + (Number(g.l) || 0); }
      }
      return { name: r.name, sessions, games, coach: r.role === "coach" };
    }).filter(r => !r.coach || r.sessions || r.games)
      .map(r => ({ name: r.name, sessions: r.sessions, games: r.games }))
      .sort((x, y) => y.sessions - x.sessions || y.games - x.games || x.name.localeCompare(y.name, "en", { sensitivity: "base" }));
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
    await db.prepare("INSERT INTO weeks (user_id, school_id, week, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, week) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, school_id = excluded.school_id")
      .bind(user.id, school.id, wk, data, Date.now()).run();
    return json({ data: merged });
  }

  /* ----- coach only ----- */
  if (a === "coach") {
    if (user.role !== "coach") fail(403, "Coach only.");
    const rosterIds = st.rosters.map(r => r.id);
    const writeWeek = (uid, wk, d) => db.prepare("INSERT INTO weeks (user_id, school_id, week, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, week) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(uid, school.id, wk, JSON.stringify(d), Date.now());

    // The first Backpost admin account can only be made by a coach of the founding team.
    if (key === "POST coach/claim-admin" && !c) {
      if (school.id !== LEGACY_SCHOOL) fail(404, "Not found.");
      return await createFirstAdmin(db, req, body);
    }
    if (key === "GET coach/players" && !c) {
      const { results } = await db.prepare("SELECT * FROM users WHERE school_id = ? ORDER BY username COLLATE NOCASE").bind(school.id).all();
      return json({ players: results.map(pub) });
    }
    if (key === "POST coach/players" && !c) {
      const name = cleanName(body.name);
      if (!name) fail(400, "Enter a name.");
      if (await nameTaken(db, school, name, null)) fail(409, "That name is taken.");
      // The admin can add a coach directly; coaches add players.
      const role = user.admin && body.role === "coach" ? "coach" : "player";
      const pw = checkNewPw(body.password, role === "coach" ? 8 : 6);
      const raw = String(body.trackerUrl || "").trim();
      const url = trackerUrl(raw);
      if (raw && !url) fail(400, "That isn't a Rocket League Tracker profile link.");
      const id = newId();
      const team = role === "coach" ? null : rosterIds.includes(body.team) ? body.team : rosterIds[0];
      await db.prepare("INSERT INTO users (id, school_id, username, role, team, pw_hash, tracker_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, school.id, name, role, team, await makePw(pw), url || null, Date.now()).run();
      const u = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
      return json({ player: pub(u) });
    }
    if (b === "players" && c) {
      const target = await member(db, school, c);
      if (!target) fail(404, "That player no longer exists.");
      if (segs[3] === "sessions" && method === "DELETE") {
        const wk = weekId(segs[4]), sid = segs[5];
        if (!sid) fail(400, "Bad request.");
        const row = await db.prepare("SELECT data FROM weeks WHERE user_id = ? AND week = ?").bind(c, wk).first();
        const d = row ? parse(row.data, {}) : {};
        const sessions = Array.isArray(d.sessions) ? d.sessions : [];
        d.sessions = sessions.filter(s => !(isPlain(s) && s.id === sid));
        d.removed = (Array.isArray(d.removed) ? d.removed : []).concat([sid]).slice(-300);
        d.week = wk;
        const ops = [writeWeek(c, wk, d)];
        const act = parse(target.active, null);
        if (isPlain(act) && act.id === sid) ops.push(db.prepare("UPDATE users SET active = 'null' WHERE id = ?").bind(c));
        await db.batch(ops);
        return json({ ok: true });
      }
      if (segs[3] === "sessions" && segs[6] === "note" && method === "PUT") {
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
        await writeWeek(c, wk, d).run();
        if (note && note !== before && c !== user.id) later(notifyS([c], { title: "Coach left a note", body: clip(note, 160), url: goUrl(school, "go=week&wk=" + wk), tag: "note-" + sid }));
        return json({ ok: true, note });
      }
      if (segs[3] === "sessions" && segs[5] && !segs[6] && method === "PUT") {
        const wk = weekId(segs[4]), sid = segs[5];
        const row = await db.prepare("SELECT data FROM weeks WHERE user_id = ? AND week = ?").bind(c, wk).first();
        const d = row ? parse(row.data, {}) : {};
        const list = Array.isArray(d.sessions) ? d.sessions : [];
        const s = list.find(x => isPlain(x) && x.id === sid);
        if (!s) fail(404, "That session no longer exists.");
        if (!s.endedAt) fail(400, "Sessions can be edited once they're checked out.");
        applyCoachEdit(s, body.session, wk, Date.now());
        list.sort((x, y) => String(x.startedAt).localeCompare(String(y.startedAt)));
        await writeWeek(c, wk, d).run();
        return json({ ok: true, session: s });
      }
      if (segs[3] === "weeks" && method === "GET") {
        const { results } = await db.prepare("SELECT week, data FROM weeks WHERE user_id = ? ORDER BY week DESC LIMIT 80").bind(c).all();
        return json({ weeks: results.map(r => ({ week: r.week, data: parse(r.data, {}) })) });
      }
      if (segs[3] === "history" && method === "GET") return json({ history: await readHistory(db, c) });
      if (!segs[3] && method === "DELETE") {
        if (target.role === "coach" && !user.admin) fail(400, "Only the Backpost admin can remove a coach account.");
        await db.batch([
          db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(c),
          db.prepare("DELETE FROM weeks WHERE user_id = ?").bind(c),
          db.prepare("DELETE FROM rank_history WHERE user_id = ?").bind(c),
          db.prepare("DELETE FROM reviews WHERE user_id = ?").bind(c),
          db.prepare("DELETE FROM push_subs WHERE user_id = ?").bind(c),
          db.prepare("DELETE FROM rsvps WHERE user_id = ?").bind(c),
          db.prepare("DELETE FROM users WHERE id = ? AND school_id = ?").bind(c, school.id)
        ]);
        return json({ ok: true });
      }
      if (!segs[3] && method === "PATCH") {
        const sets = [], vals = [], extra = [];
        // Only the Backpost admin can make someone a coach or a player.
        let role = target.role;
        if ("role" in body && body.role !== target.role) {
          if (!user.admin) fail(403, "Only the Backpost admin can change who's a coach.");
          role = body.role === "coach" ? "coach" : "player";
          sets.push("role = ?"); vals.push(role);
          if (role === "player" && !("team" in body) && !rosterIds.includes(target.team)) { sets.push("team = ?"); vals.push(rosterIds[0]); }
          if (role === "coach") sets.push("team = NULL");
        }
        if ("name" in body) {
          const name = cleanName(body.name);
          if (!name) fail(400, "Enter a name.");
          if (await nameTaken(db, school, name, c)) fail(409, "That name is taken.");
          sets.push("username = ?"); vals.push(name);
        }
        if ("team" in body) {
          if (role === "coach") fail(400, "Coaches aren't on a roster.");
          if (!rosterIds.includes(body.team)) fail(400, "Pick one of your rosters.");
          sets.push("team = ?"); vals.push(body.team);
        }
        if ("trackerUrl" in body) {
          const raw = String(body.trackerUrl || "").trim();
          const url = trackerUrl(raw);
          if (raw && !url) fail(400, "That isn't a Rocket League Tracker profile link.");
          sets.push("tracker_url = ?"); vals.push(url || null);
        }
        if ("password" in body) {
          if (role === "coach" && !user.admin) fail(400, "Coaches change their own password from Account.");
          const pw = checkNewPw(body.password, role === "coach" ? 8 : 6);
          sets.push("pw_hash = ?", "fail_count = 0", "locked_until = 0"); vals.push(await makePw(pw));
          extra.push(db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(c));
        }
        if ("targets" in body) {
          if (role === "coach") fail(400, "Coaches don't have a weekly requirement.");
          const t = isPlain(body.targets) ? body.targets : {};
          const own = v => (v === null || v === undefined || v === "" ? null : intIn(v, 14));
          const log = logPut(normPlayerLog(parse(target.targets, [])), { from: weekFrom(body.from), ranked: own(t.ranked), training: own(t.training) }, { from: LOG_START, ranked: null, training: null });
          sets.push("targets = ?"); vals.push(JSON.stringify(log));
        }
        let newRanks = null;
        if ("ranks" in body) { newRanks = applyRanks(parse(target.ranks, {}), body.ranks, false); sets.push("ranks = ?"); vals.push(JSON.stringify(newRanks)); }
        if (sets.length) await db.batch([db.prepare("UPDATE users SET " + sets.join(", ") + " WHERE id = ? AND school_id = ?").bind(...vals, c, school.id)].concat(extra));
        if (newRanks) await recordHistory(db, c, newRanks);
        const u = await member(db, school, c);
        return json({ player: pub(u) });
      }
    }
    if (key === "GET coach/weeks" && c) {
      const wk = weekId(c);
      const { results } = await db.prepare("SELECT w.user_id, w.data FROM weeks w JOIN users u ON u.id = w.user_id WHERE w.week = ? AND u.school_id = ?").bind(wk, school.id).all();
      return json({ week: wk, weeks: results.map(r => ({ userId: r.user_id, data: parse(r.data, {}) })) });
    }
    if (key === "PUT coach/settings") {
      const s = normSettings(body.settings, school);
      // Uploaded logos only change through coach/asset, and the requirement history only through this log.
      s.logo = st.logo; s.icon = st.icon;
      s.targetsLog = st.targetsLog;
      const keys = ["ranked", "training", "minGames", "minMinutes"];
      if (keys.some(k => s.targets[k] !== st.targets[k])) {
        s.targetsLog = logPut(st.targetsLog, Object.assign({ from: weekFrom(body.from) }, s.targets), Object.assign({ from: LOG_START }, st.targets));
      }
      // New rosters see the schedule unless they have no set sessions.
      for (const r of s.rosters) if (!st.rosters.some(x => x.id === r.id) && !r.casual && !s.schedRosters.includes(r.id)) s.schedRosters.push(r.id);
      // A roster can only be removed once nobody is on it.
      const gone = st.rosters.filter(r => !s.rosters.some(x => x.id === r.id));
      if (gone.length) {
        const { results } = await db.prepare("SELECT team, COUNT(*) AS n FROM users WHERE school_id = ? AND role = 'player' GROUP BY team").bind(school.id).all();
        for (const r of gone) {
          const hit = results.find(x => x.team === r.id);
          if (hit && hit.n) fail(400, "Move the " + hit.n + " player" + (hit.n === 1 ? "" : "s") + " on " + r.name + " to another roster first.");
        }
      }
      await putSettings(db, school, s);
      return json({ settings: s });
    }
    if (key === "PUT coach/asset") {
      // A logo (shown in the header) and an app icon (512 x 512, for installs), both PNG, made in the browser.
      const png = v => {
        if (typeof v !== "string" || !/^[A-Za-z0-9+/=]+$/.test(v) || v.length > 560000) fail(400, "That image is too big. Try a smaller one.");
        const bytes = unb64(v);
        const sig = [137, 80, 78, 71, 13, 10, 26, 10];
        if (bytes.length < 60 || sig.some((x, i) => bytes[i] !== x)) fail(400, "That image couldn't be read.");
        return v;
      };
      const logo = png(body.logo), icon = png(body.icon), now = Date.now();
      await db.batch([
        db.prepare("INSERT INTO school_assets (school_id, kind, mime, data, updated_at) VALUES (?, 'logo', 'image/png', ?, ?) ON CONFLICT(school_id, kind) DO UPDATE SET data = excluded.data, mime = excluded.mime, updated_at = excluded.updated_at").bind(school.id, logo, now),
        db.prepare("INSERT INTO school_assets (school_id, kind, mime, data, updated_at) VALUES (?, 'icon', 'image/png', ?, ?) ON CONFLICT(school_id, kind) DO UPDATE SET data = excluded.data, mime = excluded.mime, updated_at = excluded.updated_at").bind(school.id, icon, now)
      ]);
      const s = Object.assign({}, st, { logo: "/api/s/" + school.id + "/asset/logo?v=" + now, icon: "/api/s/" + school.id + "/asset/icon?v=" + now });
      await putSettings(db, school, s);
      return json({ settings: s });
    }
    if (key === "DELETE coach/asset") {
      await db.prepare("DELETE FROM school_assets WHERE school_id = ?").bind(school.id).run();
      const s = Object.assign({}, st, { logo: "", icon: "" });
      await putSettings(db, school, s);
      return json({ settings: s });
    }
    if (key === "GET coach/events") {
      const { results } = await db.prepare("SELECT * FROM events WHERE school_id = ? AND starts_at >= ? ORDER BY starts_at LIMIT 300").bind(school.id, Date.now() - SCHED_PAST_MS).all();
      return json({ events: await eventsWithRsvps(db, results, null) });
    }
    if (key === "POST coach/events") {
      const e = normEvent(body, st), id = newId(), now = Date.now();
      await db.prepare("INSERT INTO events (id, school_id, kind, opponent, starts_at, format, details, link, teams, result, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, school.id, e.kind, e.opponent, e.startsAt, packFormat(e), e.details, e.link, JSON.stringify(e.teams), e.result, now, now).run();
      if (e.startsAt > now) later(eventAudience(db, school, st, e.teams).then(ids => notifyS(ids, { title: "New: " + eventTitle(e), body: fmtWhen(e.startsAt, st.tz) + (e.format ? ", " + e.format : ""), url: goUrl(school, "go=schedule"), tag: "ev-" + id })));
      const row = await db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
      return json({ event: pubEvent(row, [], null) });
    }
    if (b === "events" && c && method === "PUT") {
      const prev = await db.prepare("SELECT * FROM events WHERE id = ? AND school_id = ?").bind(c, school.id).first();
      if (!prev) fail(404, "That event no longer exists.");
      const e = normEvent(body, st);
      await db.prepare("UPDATE events SET kind = ?, opponent = ?, starts_at = ?, format = ?, details = ?, link = ?, teams = ?, result = ?, updated_at = ? WHERE id = ? AND school_id = ?")
        .bind(e.kind, e.opponent, e.startsAt, packFormat(e), e.details, e.link, JSON.stringify(e.teams), e.result, Date.now(), c, school.id).run();
      // Only a new time is worth a notification (and only for events still ahead).
      if (e.startsAt !== prev.starts_at && e.startsAt > Date.now()) later(eventAudience(db, school, st, e.teams).then(ids => notifyS(ids, { title: "Moved: " + eventTitle(e), body: "Now " + fmtWhen(e.startsAt, st.tz), url: goUrl(school, "go=schedule"), tag: "ev-" + c })));
      const row = await db.prepare("SELECT * FROM events WHERE id = ?").bind(c).first();
      return json({ event: (await eventsWithRsvps(db, [row], null))[0] });
    }
    if (b === "events" && c && method === "DELETE") {
      const prev = await db.prepare("SELECT * FROM events WHERE id = ? AND school_id = ?").bind(c, school.id).first();
      if (!prev) return json({ ok: true });
      await db.batch([db.prepare("DELETE FROM rsvps WHERE event_id = ?").bind(c), db.prepare("DELETE FROM events WHERE id = ? AND school_id = ?").bind(c, school.id)]);
      if (prev.starts_at > Date.now()) later(eventAudience(db, school, st, parse(prev.teams, [])).then(ids => notifyS(ids, { title: "Canceled: " + eventTitle(prev), body: "Was " + fmtWhen(prev.starts_at, st.tz), url: goUrl(school, "go=schedule"), tag: "ev-" + c })));
      return json({ ok: true });
    }
    if (key === "GET coach/reviews") {
      const { results } = await db.prepare("SELECT r.*, u.username FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.school_id = ? AND u.school_id = ? ORDER BY (r.status = 'open') DESC, r.created_at DESC LIMIT 200").bind(school.id, school.id).all();
      return json({ reviews: results.map(pubReview) });
    }
    if (b === "reviews" && c && method === "PATCH") {
      const status = body.status === "done" ? "done" : "open";
      const prev = await db.prepare("SELECT user_id, status, playlist FROM reviews WHERE id = ? AND school_id = ?").bind(c, school.id).first();
      if (!prev) fail(404, "That request no longer exists.");
      await db.prepare("UPDATE reviews SET status = ?, done_at = ? WHERE id = ? AND school_id = ?").bind(status, status === "done" ? Date.now() : null, c, school.id).run();
      if (prev.status !== "done" && status === "done" && prev.user_id !== user.id) {
        const pl = { duel: "1v1 Duel", doubles: "2v2 Doubles", standard: "3v3 Standard" }[prev.playlist];
        later(notifyS([prev.user_id], { title: "Replay reviewed", body: "Coach went over your " + (pl ? pl + " " : "") + "replay.", url: goUrl(school, "go=week"), tag: "rvd-" + c }));
      }
      return json({ ok: true, status });
    }
    if (b === "reviews" && c && method === "DELETE") {
      await db.prepare("DELETE FROM reviews WHERE id = ? AND school_id = ?").bind(c, school.id).run();
      return json({ ok: true });
    }
    if (key === "GET coach/trackers") {
      const { results } = await db.prepare("SELECT id, username, tracker_url FROM users WHERE school_id = ? AND tracker_url IS NOT NULL AND tracker_url <> '' ORDER BY username COLLATE NOCASE").bind(school.id).all();
      return json({ players: results.map(r => ({ id: r.id, name: r.username, trackerUrl: r.tracker_url })) });
    }
    if (key === "POST coach/ranks") {
      const updates = Array.isArray(body.updates) ? body.updates.slice(0, 200) : fail(400, "Bad request.");
      let saved = 0;
      for (const up of updates) {
        if (!isPlain(up) || typeof up.id !== "string" || !isPlain(up.playlists)) continue;
        const row = await db.prepare("SELECT ranks FROM users WHERE id = ? AND school_id = ?").bind(up.id, school.id).first();
        if (!row) continue;
        const next = applyRanks(parse(row.ranks, {}), up.playlists, true);
        await db.prepare("UPDATE users SET ranks = ? WHERE id = ? AND school_id = ?").bind(JSON.stringify(next), up.id, school.id).run();
        await recordHistory(db, up.id, next);
        saved++;
      }
      return json({ saved });
    }
  }

  fail(404, "Not found.");
}

/* ---------- Platform admin (Gage): schools, invites, access requests ---------- */
// The admin sign-in is sent to every /api route so the admin can manage any school as a coach.
// (Before that it lived at /api/admin only; OLD_ADMIN_JAR is cleared when the admin page loads.)
const ADMIN_JAR = { name: "bp_a", path: "/api" };
const OLD_ADMIN_JAR = { name: "bp_a", path: "/api/admin" };
// The admin, inside a school: a coach with a few extra powers (coach accounts, nothing personal).
function adminAsCoach(adm, school) {
  return {
    id: "admin-" + adm.id, username: adm.username, role: "coach", team: null, school_id: school.id, admin: true,
    tracker_url: "", ranks: null, active: null, custom_focus: null, targets: null, prefs: null,
    created_at: adm.created_at, s_exp: Infinity, s_hash: null
  };
}
async function currentAdmin(db, req) {
  const t = readCookie(req, ADMIN_JAR.name);
  if (!t) return null;
  const row = await db.prepare("SELECT a.*, s.expires_at AS s_exp, s.token_hash AS s_hash FROM admin_sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ?").bind(await sha256hex(t)).first();
  return row && row.s_exp >= Date.now() ? row : null;
}
async function startAdminSession(db, req, adminId) {
  const { token, hash } = await newToken(), now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").bind(now),
    db.prepare("INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)").bind(hash, adminId, now + 14 * 864e5)
  ]);
  return setCookie(req, ADMIN_JAR, token, 14 * 86400);
}
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([sha256hex(a), sha256hex(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}
async function createFirstAdmin(db, req, body) {
  const name = cleanName(body.name);
  if (!name) fail(400, "Enter a name.");
  const pw = checkNewPw(body.password, 10);
  const id = newId();
  const res = await db.prepare("INSERT INTO admins (id, username, pw_hash, created_at) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM admins)").bind(id, name, await makePw(pw), Date.now()).run();
  if (!res.meta || !res.meta.changes) fail(409, "The admin account already exists.");
  return json({ me: { id, name } }, 200, { "Set-Cookie": await startAdminSession(db, req, id) });
}
function schoolRow(r) {
  return { id: r.id, name: r.name, status: r.status, createdAt: r.created_at, players: r.players || 0, coaches: r.coaches || 0, lastActive: r.last_active || null, invites: r.invites || 0 };
}
async function adminRoute(ctx, segs) {
  const { db, req, method, body, origin } = ctx;
  const [a, b, c] = segs;
  const key = method + " " + [a, b].filter(Boolean).join("/");
  const admin = await currentAdmin(db, req);

  if (key === "GET state") {
    const any = await db.prepare("SELECT 1 AS x FROM admins LIMIT 1").first();
    const founder = any ? null : await loadSchool(db, LEGACY_SCHOOL);
    const res = json({ needsSetup: !any, founder: founder ? { slug: founder.id, name: founder.name } : null, me: admin ? { id: admin.id, name: admin.username } : null });
    if (admin) {
      // Move an older admin sign-in (sent only to /api/admin) to /api, keeping when it ends.
      res.headers.append("Set-Cookie", setCookie(req, OLD_ADMIN_JAR, "", 0));
      res.headers.append("Set-Cookie", setCookie(req, ADMIN_JAR, readCookie(req, ADMIN_JAR.name), Math.max(60, Math.floor((admin.s_exp - Date.now()) / 1000))));
    }
    return res;
  }
  if (key === "POST setup") {
    // Open first-run setup would let anyone claim the admin account, so it needs the
    // setup key (fresh installs and tests). On the live site, a founding-team coach uses coach/claim-admin.
    const want = ctx.env && ctx.env.ADMIN_SETUP_KEY ? String(ctx.env.ADMIN_SETUP_KEY) : "";
    if (!want || !(await sameSecret(String(body.setupKey || ""), want))) fail(403, "Sign in as a coach of the founding team to set up the admin account.");
    return await createFirstAdmin(db, req, body);
  }
  if (key === "POST login") {
    const name = cleanName(body.name);
    const u = name ? await db.prepare("SELECT * FROM admins WHERE username = ? COLLATE NOCASE").bind(name).first() : null;
    if (!u) { await derive("x", new Uint8Array(16), PW_ITER); fail(401, "Wrong name or password."); }
    if (u.locked_until > Date.now()) fail(429, "Too many tries. Wait a few minutes.");
    if (!(await checkPw(body.password, u.pw_hash))) {
      const fails = u.fail_count + 1, lock = fails >= 5;
      await db.prepare("UPDATE admins SET fail_count = ?, locked_until = ? WHERE id = ?").bind(lock ? 0 : fails, lock ? Date.now() + 30 * 60000 : 0, u.id).run();
      fail(lock ? 429 : 401, lock ? "Too many tries. Wait 30 minutes." : "Wrong name or password.");
    }
    if (u.fail_count) await db.prepare("UPDATE admins SET fail_count = 0 WHERE id = ?").bind(u.id).run();
    return json({ me: { id: u.id, name: u.username } }, 200, { "Set-Cookie": await startAdminSession(db, req, u.id) });
  }
  if (key === "POST logout") {
    if (admin) await db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(admin.s_hash).run();
    const res = json({ ok: true }, 200, { "Set-Cookie": setCookie(req, ADMIN_JAR, "", 0) });
    res.headers.append("Set-Cookie", setCookie(req, OLD_ADMIN_JAR, "", 0));
    return res;
  }
  if (!admin) fail(401, "Signed out. Sign in again.");

  if (key === "POST password") {
    if (!(await checkPw(body.current, admin.pw_hash))) fail(400, "Current password is wrong.");
    const pw = checkNewPw(body.next, 10);
    await db.batch([
      db.prepare("UPDATE admins SET pw_hash = ? WHERE id = ?").bind(await makePw(pw), admin.id),
      db.prepare("DELETE FROM admin_sessions WHERE admin_id = ? AND token_hash <> ?").bind(admin.id, admin.s_hash)
    ]);
    return json({ ok: true });
  }
  if (key === "GET schools") {
    const { results } = await db.prepare(`SELECT s.*,
        (SELECT COUNT(*) FROM users u WHERE u.school_id = s.id AND u.role = 'player') AS players,
        (SELECT COUNT(*) FROM users u WHERE u.school_id = s.id AND u.role = 'coach') AS coaches,
        (SELECT MAX(w.updated_at) FROM weeks w WHERE w.school_id = s.id) AS last_active,
        (SELECT COUNT(*) FROM invites i WHERE i.school_id = s.id AND i.used_at IS NULL AND i.expires_at > ?) AS invites
      FROM schools s ORDER BY s.name COLLATE NOCASE`).bind(Date.now()).all();
    return json({ schools: results.map(schoolRow) });
  }
  if (key === "POST schools") {
    const name = cleanName(body.name).slice(0, 60);
    if (!name) fail(400, "Enter the school or team name.");
    const slug = String(body.slug || "").trim().toLowerCase() || slugify(name);
    if (!isSlug(slug)) fail(400, "The web address can use letters, numbers and dashes (2 to 32 characters).");
    if (await db.prepare("SELECT 1 AS x FROM schools WHERE id = ?").bind(slug).first()) fail(409, "getbackpost.com/" + slug + " is already taken.");
    const theme = normTheme({ primary: body.primary, secondary: body.secondary });
    const s = normSettings({ title: name, theme }, { id: slug, name });
    await db.batch([
      db.prepare("INSERT INTO schools (id, name, status, created_at) VALUES (?, ?, 'active', ?)").bind(slug, name, Date.now()),
      db.prepare("INSERT INTO school_settings (school_id, data) VALUES (?, ?)").bind(slug, JSON.stringify(s))
    ]);
    schoolCache.delete(slug);
    return json({ school: schoolRow({ id: slug, name, status: "active", created_at: Date.now() }) });
  }
  if (a === "schools" && b) {
    const school = await db.prepare("SELECT * FROM schools WHERE id = ?").bind(b).first();
    if (!school) fail(404, "That school no longer exists.");
    schoolCache.delete(b);
    if (!c && method === "PATCH") {
      const sets = [], vals = [];
      if ("name" in body) { const n = cleanName(body.name).slice(0, 60); if (!n) fail(400, "Enter a name."); sets.push("name = ?"); vals.push(n); }
      if ("status" in body) { sets.push("status = ?"); vals.push(body.status === "paused" ? "paused" : "active"); }
      let id = b;
      const want = "slug" in body ? String(body.slug || "").trim().toLowerCase() : b;
      if (want !== b) {
        // A new web address: everything in the school moves with it. Sign-ins are tied to the old
        // address, so everyone signs in again at the new one.
        if (b === LEGACY_SCHOOL) fail(400, "Nebraska keeps getbackpost.com/" + LEGACY_SCHOOL + " so the original site address keeps working.");
        if (!isSlug(want)) fail(400, "The web address can use letters, numbers and dashes (2 to 32 characters).");
        if (await db.prepare("SELECT 1 AS x FROM schools WHERE id = ?").bind(want).first()) fail(409, "getbackpost.com/" + want + " is already taken.");
        const row = await db.prepare("SELECT data FROM school_settings WHERE school_id = ?").bind(b).first();
        const data = row ? row.data.split("/api/s/" + b + "/asset/").join("/api/s/" + want + "/asset/") : null;
        const move = t => db.prepare("UPDATE " + t + " SET school_id = ? WHERE school_id = ?").bind(want, b);
        await db.batch([
          db.prepare("UPDATE schools SET id = ? WHERE id = ?").bind(want, b),
          move("school_settings"), move("school_assets"), move("users"), move("weeks"), move("reviews"), move("events"), move("invites"),
          ...(data ? [db.prepare("UPDATE school_settings SET data = ? WHERE school_id = ?").bind(data, want)] : []),
          db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE school_id = ?)").bind(want)
        ]);
        schoolCache.delete(b); schoolCache.delete(want);
        id = want;
      }
      if (sets.length) await db.prepare("UPDATE schools SET " + sets.join(", ") + " WHERE id = ?").bind(...vals, id).run();
      const r = await db.prepare("SELECT * FROM schools WHERE id = ?").bind(id).first();
      return json({ school: schoolRow(r) });
    }
    if (!c && method === "DELETE") {
      // Removing a school deletes everything in it, so the admin types its web address to confirm.
      if (body.confirm !== b) fail(400, "Type the school's web address (" + b + ") to confirm.");
      const sub = "SELECT id FROM users WHERE school_id = ?";
      await db.batch([
        db.prepare("DELETE FROM sessions WHERE user_id IN (" + sub + ")").bind(b),
        db.prepare("DELETE FROM rank_history WHERE user_id IN (" + sub + ")").bind(b),
        db.prepare("DELETE FROM push_subs WHERE user_id IN (" + sub + ")").bind(b),
        db.prepare("DELETE FROM rsvps WHERE user_id IN (" + sub + ")").bind(b),
        db.prepare("DELETE FROM weeks WHERE school_id = ?").bind(b),
        db.prepare("DELETE FROM reviews WHERE school_id = ?").bind(b),
        db.prepare("DELETE FROM events WHERE school_id = ?").bind(b),
        db.prepare("DELETE FROM invites WHERE school_id = ?").bind(b),
        db.prepare("DELETE FROM school_assets WHERE school_id = ?").bind(b),
        db.prepare("DELETE FROM school_settings WHERE school_id = ?").bind(b),
        db.prepare("DELETE FROM users WHERE school_id = ?").bind(b),
        db.prepare("DELETE FROM schools WHERE id = ?").bind(b)
      ]);
      return json({ ok: true });
    }
    if (c === "invites" && method === "POST") {
      // A one-time link: the coach who opens it picks their own name and password.
      const { token, hash } = await newToken(), id = newId(), now = Date.now();
      const days = Math.min(30, Math.max(1, Math.round(Number(body.days) || 14)));
      await db.prepare("INSERT INTO invites (id, token_hash, school_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").bind(id, hash, b, now, now + days * 864e5).run();
      return json({ invite: { id, link: origin + "/join/" + token, expiresAt: now + days * 864e5 } });
    }
    if (c === "invites" && method === "GET") {
      const { results } = await db.prepare("SELECT i.id, i.created_at, i.expires_at, i.used_at, u.username AS used_by FROM invites i LEFT JOIN users u ON u.id = i.used_by WHERE i.school_id = ? ORDER BY i.created_at DESC LIMIT 50").bind(b).all();
      return json({ invites: results.map(r => ({ id: r.id, createdAt: r.created_at, expiresAt: r.expires_at, usedAt: r.used_at, usedBy: r.used_by || null })) });
    }
  }
  if (a === "invites" && b && method === "DELETE") {
    await db.prepare("DELETE FROM invites WHERE id = ? AND used_at IS NULL").bind(b).run();
    return json({ ok: true });
  }
  if (key === "GET requests") {
    const { results } = await db.prepare("SELECT * FROM access_requests ORDER BY (status = 'new') DESC, created_at DESC LIMIT 200").all();
    return json({ requests: results.map(r => ({ id: r.id, school: r.school, name: r.name, email: r.email, role: r.role || "", message: r.message || "", status: r.status, createdAt: r.created_at })) });
  }
  if (a === "requests" && b && method === "PATCH") {
    await db.prepare("UPDATE access_requests SET status = ? WHERE id = ?").bind(body.status === "done" ? "done" : "new", b).run();
    return json({ ok: true });
  }
  if (a === "requests" && b && method === "DELETE") {
    await db.prepare("DELETE FROM access_requests WHERE id = ?").bind(b).run();
    return json({ ok: true });
  }
  fail(404, "Not found.");
}

/* ---------- A coach accepting an invite ---------- */
async function joinRoute(ctx, segs) {
  const { db, req, method, body } = ctx;
  const token = segs[0] || "";
  if (!/^[a-f0-9]{64}$/.test(token) || segs.length > 1) fail(404, "This invite link isn't valid.");
  const inv = await db.prepare("SELECT * FROM invites WHERE token_hash = ?").bind(await sha256hex(token)).first();
  if (!inv) fail(404, "This invite link isn't valid.");
  const school = await db.prepare("SELECT * FROM schools WHERE id = ?").bind(inv.school_id).first();
  if (!school) fail(404, "This invite link isn't valid.");
  if (inv.used_at) fail(410, "This invite was already used. Sign in at getbackpost.com/" + school.id + ".");
  if (inv.expires_at < Date.now()) fail(410, "This invite has expired. Ask for a new link.");
  const st = await getSettings(db, school);
  if (method === "GET") return json({ school: { slug: school.id, name: school.name }, settings: publicSettings(st) });
  if (method !== "POST") fail(404, "Not found.");
  const name = cleanName(body.name);
  if (!name) fail(400, "Enter your name.");
  const pw = checkNewPw(body.password, 8);
  if (await nameTaken(db, school, name, null)) fail(409, "That name is taken at " + st.title + ". Try another.");
  const id = newId(), now = Date.now();
  const used = await db.prepare("UPDATE invites SET used_at = ?, used_by = ? WHERE id = ? AND used_at IS NULL").bind(now, id, inv.id).run();
  if (!used.meta || !used.meta.changes) fail(410, "This invite was already used.");
  await db.prepare("INSERT INTO users (id, school_id, username, role, pw_hash, created_at) VALUES (?, ?, ?, 'coach', ?, ?)").bind(id, school.id, name, await makePw(pw), now).run();
  const jar = { name: "bp_s", path: "/api/s/" + school.id };
  return json({ slug: school.id }, 200, { "Set-Cookie": await startSession(db, req, jar, id) });
}

/* ---------- Landing page: request access ---------- */
async function publicRoute(ctx, segs) {
  const { db, req, method, body } = ctx;
  if (method === "POST" && segs[0] === "request" && segs.length === 1) {
    // Bots fill in every field; people never see this one.
    if (body.website) return json({ ok: true });
    const school = cleanName(body.school).slice(0, 80), name = cleanName(body.name).slice(0, 60);
    const email = String(body.email || "").trim().slice(0, 120);
    if (!school) fail(400, "Enter your school or team.");
    if (!name) fail(400, "Enter your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail(400, "Enter an email we can reach you at.");
    const ip = req.headers.get("CF-Connecting-IP") || "local";
    const ipHash = await sha256hex("bp-request:" + ip);
    const now = Date.now();
    const recent = await db.prepare("SELECT COUNT(*) AS n FROM access_requests WHERE ip_hash = ? AND created_at > ?").bind(ipHash, now - 3600e3).first();
    if (recent && recent.n >= 3) fail(429, "We got your request. Give us a bit before sending another.");
    const day = await db.prepare("SELECT COUNT(*) AS n FROM access_requests WHERE created_at > ?").bind(now - 864e5).first();
    if (day && day.n >= 100) fail(429, "We're getting a lot of requests right now. Try again tomorrow.");
    await db.prepare("INSERT INTO access_requests (id, school, name, email, role, message, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(newId(), school, name, email, cleanName(body.role).slice(0, 40), cleanText(body.message, 1000).trim(), ipHash, now).run();
    return json({ ok: true });
  }
  fail(404, "Not found.");
}
