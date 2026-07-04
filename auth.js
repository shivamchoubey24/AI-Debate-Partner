// auth.js
// Minimal cookie-session auth. Passwords are hashed with bcryptjs (pure JS,
// no native compile step — deliberately avoided native `bcrypt` for the same
// portability reason node:sqlite was chosen over better-sqlite3).

const bcrypt = require("bcryptjs");
const { nanoid } = require("nanoid");
const db = require("./db");

const SALT_ROUNDS = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(user) {
  return { id: user.id, email: user.email, displayName: user.display_name };
}

async function signup({ email, password, displayName }) {
  if (!email || !EMAIL_RE.test(email)) throw httpError(400, "Enter a valid email address.");
  if (!password || password.length < 8) throw httpError(400, "Password must be at least 8 characters.");
  if (db.getUserByEmail(email)) throw httpError(409, "An account with that email already exists.");

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = db.createUser({ id: nanoid(12), email, passwordHash, displayName });
  return publicUser(user);
}

async function login({ email, password }) {
  const user = db.getUserByEmail(email || "");
  if (!user) throw httpError(401, "Incorrect email or password.");
  const ok = await bcrypt.compare(password || "", user.password_hash);
  if (!ok) throw httpError(401, "Incorrect email or password.");
  return publicUser(user);
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Express middleware: requires req.session.userId to be set. */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Sign in to continue." });
  }
  next();
}

module.exports = { signup, login, requireAuth, publicUser };
