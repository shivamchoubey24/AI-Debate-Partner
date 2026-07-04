// db.js
// Real SQL persistence using Node's built-in `node:sqlite` (stable Node 22.5+,
// experimental flag prints a warning but works fine). Chosen specifically to
// avoid native-compiled drivers like better-sqlite3, which require a working
// C++ toolchain / prebuilt binary and are a common source of "npm install"
// failures on student laptops and CI images.

const path = require("path");
const fs = require("fs");
let DatabaseSync;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (err) {
  console.error(
    "\nThis project requires Node.js 22.5+ for the built-in node:sqlite module.\n" +
      "Check your version with `node -v` and upgrade at https://nodejs.org if needed.\n"
  );
  throw err;
}

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILENAME = process.env.NODE_ENV === "test" ? "rostrum.test.db" : "rostrum.db";
const db = new DatabaseSync(path.join(DATA_DIR, DB_FILENAME));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS debates (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    user_stance TEXT NOT NULL,
    ai_stance TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    opening_statement TEXT,
    sources TEXT,            -- JSON array of grounding sources, or null
    rounds TEXT NOT NULL,     -- JSON array
    summary TEXT,             -- JSON object, or null
    created_at TEXT NOT NULL,
    ended_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_debates_user ON debates(user_id);
`);

/* ---------------- Users ---------------- */

function createUser({ id, email, passwordHash, displayName }) {
  db.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(id, email.toLowerCase().trim(), passwordHash, displayName || email.split("@")[0], new Date().toISOString());
  return getUserByEmail(email);
}

function getUserByEmail(email) {
  return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase().trim()) || null;
}

function getUserById(id) {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) || null;
}

/* ---------------- Debates ---------------- */

function createDebate(d) {
  db.prepare(
    `INSERT INTO debates (id, user_id, topic, user_stance, ai_stance, difficulty, opening_statement, sources, rounds, summary, created_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    d.id,
    d.userId,
    d.topic,
    d.userStance,
    d.aiStance,
    d.difficulty,
    d.openingStatement || "",
    JSON.stringify(d.sources || []),
    JSON.stringify(d.rounds || []),
    d.summary ? JSON.stringify(d.summary) : null,
    d.createdAt,
    d.endedAt || null
  );
  return getDebate(d.id, d.userId);
}

function rowToDebate(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    topic: row.topic,
    userStance: row.user_stance,
    aiStance: row.ai_stance,
    difficulty: row.difficulty,
    openingStatement: row.opening_statement,
    sources: row.sources ? JSON.parse(row.sources) : [],
    rounds: JSON.parse(row.rounds),
    summary: row.summary ? JSON.parse(row.summary) : null,
    createdAt: row.created_at,
    endedAt: row.ended_at,
  };
}

function getDebate(id, userId) {
  const row = userId
    ? db.prepare(`SELECT * FROM debates WHERE id = ? AND user_id = ?`).get(id, userId)
    : db.prepare(`SELECT * FROM debates WHERE id = ?`).get(id);
  return rowToDebate(row);
}

function updateDebate(id, userId, updater) {
  const current = getDebate(id, userId);
  if (!current) return null;
  const updated = updater(current);
  db.prepare(
    `UPDATE debates SET difficulty = ?, rounds = ?, summary = ?, ended_at = ? WHERE id = ? AND user_id = ?`
  ).run(
    updated.difficulty,
    JSON.stringify(updated.rounds),
    updated.summary ? JSON.stringify(updated.summary) : null,
    updated.endedAt || null,
    id,
    userId
  );
  return getDebate(id, userId);
}

function listDebates(userId) {
  const rows = db
    .prepare(`SELECT * FROM debates WHERE user_id = ? ORDER BY created_at DESC`)
    .all(userId);
  return rows.map(rowToDebate).map((d) => ({
    id: d.id,
    topic: d.topic,
    userStance: d.userStance,
    difficulty: d.difficulty,
    createdAt: d.createdAt,
    endedAt: d.endedAt,
    rounds: d.rounds.length,
    overallScore: d.summary ? d.summary.overallScore : null,
  }));
}

module.exports = {
  createUser,
  getUserByEmail,
  getUserById,
  createDebate,
  getDebate,
  updateDebate,
  listDebates,
};
