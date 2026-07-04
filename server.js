// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const path = require("path");
const { nanoid } = require("nanoid");

const db = require("./db");
const auth = require("./auth");
const engine = require("./debateEngine");

const app = express();
const PORT = process.env.PORT || 4000;
const isProd = process.env.NODE_ENV === "production";

if (!process.env.SESSION_SECRET) {
  console.warn("⚠️  SESSION_SECRET is not set — using an insecure default. Set one in .env for real deployments.");
}

app.set("trust proxy", 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-only-insecure-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd, // requires HTTPS in production
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  })
);
app.use(express.static(path.join(__dirname, "public")));

const MAX_ROUNDS = 5;

const TOPICS = [
  { category: "Technology", topic: "Artificial intelligence will do more good than harm for humanity." },
  { category: "Technology", topic: "Social media platforms should be required to verify user age with government ID." },
  { category: "Technology", topic: "Remote work should be the default for all knowledge-work jobs." },
  { category: "Education", topic: "Standardized testing should be abolished in college admissions." },
  { category: "Education", topic: "University education should be free for all citizens." },
  { category: "Environment", topic: "Nuclear energy is essential to solving climate change." },
  { category: "Environment", topic: "Single-use plastics should be banned globally." },
  { category: "Ethics", topic: "Animal testing for medical research is morally justifiable." },
  { category: "Ethics", topic: "Capital punishment should be abolished worldwide." },
  { category: "Economics", topic: "A universal basic income should be implemented nationally." },
  { category: "Economics", topic: "Minimum wage laws do more harm than good to the economy." },
  { category: "Society", topic: "Social media has been a net negative for democracy." },
  { category: "Society", topic: "Voting should be mandatory for all eligible citizens." },
];

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

function requireApiKey(res) {
  if (!process.env.GEMINI_API_KEY) {
    res.status(500).json({
      error:
        "GEMINI_API_KEY is not set on the server. Copy .env.example to .env and add your free key from https://aistudio.google.com/apikey",
    });
    return false;
  }
  return true;
}

/** Writes one NDJSON line to an already-open streaming response. */
function writeLine(res, obj) {
  res.write(JSON.stringify(obj) + "\n");
}

/* ==================== Auth ==================== */

app.post("/api/auth/signup", async (req, res) => {
  try {
    const user = await auth.signup(req.body || {});
    req.session.userId = user.id;
    res.json({ user });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const user = await auth.login(req.body || {});
    req.session.userId = user.id;
    res.json({ user });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/auth/me", (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: "Not signed in." });
  const user = db.getUserById(req.session.userId);
  if (!user) return res.status(401).json({ error: "Not signed in." });
  res.json({ user: auth.publicUser(user) });
});

/* ==================== Public ==================== */

app.get("/api/topics", (req, res) => {
  res.json({ topics: TOPICS });
});

/** Public, read-only share link — no auth required, works for any valid debate id that has ended. */
app.get("/api/share/:id", (req, res) => {
  const debate = db.getDebate(req.params.id, null);
  if (!debate || !debate.summary) return res.status(404).json({ error: "Shared debate not found." });
  res.json({
    debate: {
      topic: debate.topic,
      userStance: debate.userStance,
      aiStance: debate.aiStance,
      difficulty: debate.difficulty,
      rounds: debate.rounds,
      summary: debate.summary,
      sources: debate.sources,
    },
  });
});

/* ==================== Debate (auth required) ==================== */

app.use("/api/debate", auth.requireAuth);
app.use("/api/history", auth.requireAuth);

app.get("/api/history", (req, res) => {
  res.json({ debates: db.listDebates(req.session.userId) });
});

app.get("/api/debate/:id", (req, res) => {
  const debate = db.getDebate(req.params.id, req.session.userId);
  if (!debate) return res.status(404).json({ error: "Debate not found." });
  res.json({ debate });
});

/** Starts a debate: fetches grounding facts, then streams the AI's opening statement as NDJSON. */
app.post("/api/debate/start", async (req, res) => {
  if (!requireApiKey(res)) return;
  const { topic, userStance, difficulty } = req.body || {};
  if (!topic || typeof topic !== "string" || !topic.trim()) return badRequest(res, "topic is required.");
  if (!["for", "against"].includes(userStance)) return badRequest(res, "userStance must be 'for' or 'against'.");
  if (!["easy", "medium", "hard"].includes(difficulty)) return badRequest(res, "difficulty must be easy/medium/hard.");

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");

  try {
    writeLine(res, { type: "status", message: "Researching the topic…" });
    const sources = await engine.getGroundingFacts(topic.trim());
    if (sources.length) writeLine(res, { type: "sources", sources });

    writeLine(res, { type: "status", message: "Opponent is preparing an opening statement…" });
    const { aiStance, openingStatement } = await engine.streamOpening(
      { topic: topic.trim(), userStance, difficulty, sources },
      (chunk) => writeLine(res, { type: "chunk", text: chunk })
    );

    const debate = db.createDebate({
      id: nanoid(10),
      userId: req.session.userId,
      topic: topic.trim(),
      userStance,
      aiStance,
      difficulty,
      openingStatement,
      sources,
      rounds: [],
      createdAt: new Date().toISOString(),
    });

    writeLine(res, { type: "done", debate });
    res.end();
  } catch (err) {
    console.error(err);
    writeLine(res, { type: "error", error: "Failed to reach the AI model. " + (err.message || "") });
    res.end();
  }
});

/** Submits one round: streams the AI rebuttal, then appends structured scoring once streaming finishes. */
app.post("/api/debate/turn", async (req, res) => {
  if (!requireApiKey(res)) return;
  const { debateId, userArgument } = req.body || {};
  if (!debateId) return badRequest(res, "debateId is required.");
  if (!userArgument || !userArgument.trim()) return badRequest(res, "userArgument is required.");

  const debate = db.getDebate(debateId, req.session.userId);
  if (!debate) return res.status(404).json({ error: "Debate not found." });
  if (debate.endedAt) return badRequest(res, "This debate has already ended.");
  if (debate.rounds.length >= MAX_ROUNDS) return badRequest(res, `Maximum of ${MAX_ROUNDS} rounds reached. End the debate for your report.`);

  const { text: cleanArgument, flagged } = engine.sanitizeUserInput(userArgument.trim());

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  if (flagged) writeLine(res, { type: "notice", message: "That message looked like it was trying to give the AI instructions — it'll be scored as an argument on its own merits, not followed." });

  try {
    const aiRebuttal = await engine.streamRebuttal(
      {
        topic: debate.topic,
        userStance: debate.userStance,
        aiStance: debate.aiStance,
        difficulty: debate.difficulty,
        rounds: debate.rounds,
        userArgument: cleanArgument,
        flagged,
      },
      (chunk) => writeLine(res, { type: "chunk", text: chunk })
    );

    writeLine(res, { type: "status", message: "Scoring your argument…" });
    const score = await engine.scoreArgument({
      topic: debate.topic,
      userStance: debate.userStance,
      difficulty: debate.difficulty,
      rounds: debate.rounds,
      userArgument: cleanArgument,
      flagged,
    });

    const round = {
      round: debate.rounds.length + 1,
      userArgument: cleanArgument,
      userScore: { logic: score.logic, evidence: score.evidence, persuasiveness: score.persuasiveness, clarity: score.clarity, overall: score.overall },
      feedback: score.feedback,
      aiRebuttal,
      timestamp: new Date().toISOString(),
    };

    const roundsSoFar = [...debate.rounds, round];
    const { difficulty: newDifficulty, changed } = engine.adjustDifficulty(debate.difficulty, roundsSoFar);
    if (changed) writeLine(res, { type: "difficultyChange", difficulty: newDifficulty, previous: debate.difficulty });

    const updated = db.updateDebate(debateId, req.session.userId, (d) => {
      d.rounds.push(round);
      d.difficulty = newDifficulty;
      return d;
    });

    writeLine(res, { type: "done", round, roundsUsed: updated.rounds.length, maxRounds: MAX_ROUNDS, difficulty: updated.difficulty });
    res.end();
  } catch (err) {
    console.error(err);
    writeLine(res, { type: "error", error: "Failed to reach the AI model. " + (err.message || "") });
    res.end();
  }
});

app.post("/api/debate/end", async (req, res) => {
  if (!requireApiKey(res)) return;
  const { debateId } = req.body || {};
  if (!debateId) return badRequest(res, "debateId is required.");

  const debate = db.getDebate(debateId, req.session.userId);
  if (!debate) return res.status(404).json({ error: "Debate not found." });
  if (debate.rounds.length === 0) return badRequest(res, "Add at least one argument before ending the debate.");

  try {
    const summary = await engine.summarizeDebate({
      topic: debate.topic,
      userStance: debate.userStance,
      aiStance: debate.aiStance,
      rounds: debate.rounds,
    });

    const updated = db.updateDebate(debateId, req.session.userId, (d) => {
      d.summary = summary;
      d.endedAt = new Date().toISOString();
      return d;
    });

    res.json({ debate: updated });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Failed to reach the AI model. " + (err.message || "") });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`AI Debate Partner running at http://localhost:${PORT}`);
    if (!process.env.GEMINI_API_KEY) {
      console.warn("⚠️  GEMINI_API_KEY is not set. Copy .env.example to .env and add your free key.");
    }
  });
}

module.exports = app;
