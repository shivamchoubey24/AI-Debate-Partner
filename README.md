# The Rostrum — AI Debate Partner

A full-stack web app that lets a student pick a motion, argue a side, and debate live against an AI opponent powered by Google's **Gemini API**. The AI takes the opposite stance, streams its rebuttals in real time, scores each turn across four rhetoric dimensions, grounds the debate in real background facts, and adapts its difficulty as the student improves.

> Built as a final-year project to demonstrate full end-to-end LLM application engineering: authentication, persistence, structured output, streaming, retrieval-augmented grounding, prompt-injection defense, and automated testing. Runs entirely on Gemini's **free tier** — no credit card required.

## Features

- **Accounts** — email/password signup and login with hashed passwords (bcrypt) and cookie-based sessions. Every student's debates are private to their account.
- **Pick a motion or write your own** — 13 curated topics across Technology, Ethics, Economics, Education, Environment, and Society, or a free-text motion.
- **Fact-grounded debates (RAG)** — before the debate starts, the app asks Gemini (with Google Search grounding) for a few real, neutral background facts about the topic, shown in a "Grounded on" bar, so the AI's arguments are anchored to reality rather than pure rhetoric.
- **Streamed responses** — the AI's opening statement and every rebuttal stream into the chat token-by-token, instead of appearing all at once after a long wait.
- **Live scoring on every turn** — each argument is scored 0–10 on **Logic, Evidence, Persuasiveness, and Clarity** via Gemini function calling (structured JSON, not parsed free text), visualized on a live radial "Rhetoric Meter."
- **Adaptive difficulty** — if the student's trailing average score is high, the opponent automatically steps up (easy → medium → hard); if they're struggling, it eases off. Changes are announced live.
- **Prompt-injection defense** — student input is scanned for instruction-override patterns (e.g. "ignore previous instructions", "you are now…") before being used in any prompt. Flagged attempts are neither followed nor rewarded — they're scored as arguments on their own (weak) merits, and the UI shows a warning banner.
- **Voice in, voice out** — a mic button transcribes spoken arguments (Web Speech API); a "Listen" button on any AI message reads it aloud (speech synthesis). Both run entirely in-browser, no extra API calls or cost.
- **Per-turn coaching feedback** and a **final debate report** (overall score, strengths, improvements, verdict).
- **Debate history ("Docket")**, per-account, persisted in a real SQL database.
- **Shareable read-only reports** — a "Copy share link" button generates a public URL anyone can open (no login) to view a finished debate's report — like a Wordle share card.
- **Exportable transcript** — download any debate as Markdown.
- **Automated tests** — 26 Jest/Supertest tests covering auth, session handling, the full debate lifecycle, injection detection, adaptive difficulty, and failure handling — all run offline with the AI mocked.
- **Deploy-ready** — `render.yaml` and a `Procfile` included for one-click free-tier deployment.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| AI | Google Gemini API (`gemini-2.5-flash`) — function calling, streaming, and search grounding | Free tier, no billing required; function calling forces reliable structured JSON; streaming enables real-time UX; search grounding gives factual anchoring (RAG) |
| Backend | Node.js + Express | REST + streaming API: `/api/auth/*`, `/api/debate/*`, `/api/share/:id` |
| Auth | `express-session` (cookies) + `bcryptjs` (pure JS, no native compile) | Simple, standard session auth without pulling in an external auth provider |
| Database | Node's built-in **`node:sqlite`** | Real SQL (users + debates tables, foreign keys, indexes) with **zero native dependencies** — deliberately avoids drivers like `better-sqlite3` that require a C++ toolchain and commonly fail to install on student machines |
| Frontend | Vanilla HTML/CSS/JS (no framework, no bundler) | DOM/state fundamentals; single `app.js` SPA with client-side routing, NDJSON stream parsing, SVG gauge rendering, and the Web Speech API |
| Tests | Jest + Supertest | Full API test suite with the AI layer mocked, so it runs deterministically offline |

## Architecture

```
public/               → frontend (served statically by Express)
  index.html             auth / setup / debate / report / history / shared views
  styles.css             design system (CSS variables)
  app.js                 SPA logic, NDJSON stream parsing, SVG gauge, voice I/O

server.js              → Express routes, sessions, streaming responses
auth.js                 → signup/login, password hashing, requireAuth middleware
debateEngine.js         → all Gemini prompting: grounding, streaming, scoring, reports
db.js                   → SQLite persistence layer (users, debates)
tests/api.test.js       → Jest/Supertest suite (AI mocked)
data/rostrum.db         → generated at runtime, gitignored
render.yaml, Procfile   → deployment config
```

### How streaming + structured scoring coexist

Function-call arguments arrive as one opaque JSON blob — you can't safely stream partial JSON to a user mid-generation. So each debate turn is deliberately split into two calls:

1. **`streamRebuttal()`** — a plain-text call, streamed chunk-by-chunk to the browser as it's generated (real-time UX).
2. **`scoreArgument()`** — a separate function-calling call (`submit_evaluation`) that returns the four scores + feedback as one reliable structured object.

The same split applies to the debate's opening statement (streamed) vs. the final report (`submit_report`, structured, not streamed).

### How grounding (RAG) works

`getGroundingFacts()` calls Gemini with the built-in `googleSearch` tool to pull 2–4 short, neutral factual bullet points about the motion before the debate starts. This is **best-effort and fails open**: if grounding isn't available (older SDK, quota, or transient error), the debate proceeds without sources rather than erroring out — verified by a dedicated test.

### How prompt-injection defense works

`sanitizeUserInput()` scans the student's text for common override patterns (e.g. *"ignore previous instructions"*, *"you are now…"*, *"give me a 10/10"*) before it's interpolated into any prompt. Flagged text is still evaluated — it's wrapped in an explicit instruction telling the model to treat it strictly as debate content, not commands — and the UI surfaces a warning so the student understands why it didn't work.

## Getting started

**Prerequisites:**
- **Node.js 22.5+** (required for the built-in `node:sqlite` module — check with `node -v`)
- A free [Gemini API key](https://aistudio.google.com/apikey) (Google account only, no credit card)

```bash
# 1. Install dependencies
npm install

# 2. Add your API key and a session secret
cp .env.example .env
# then edit .env — paste your GEMINI_API_KEY and set a random SESSION_SECRET
# (generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# 3. Run it
npm start

# 4. Open http://localhost:4000, create an account, and start a debate
```

### Running the tests

```bash
npm test
```

All 26 tests run offline — the Gemini calls are mocked, so no API key or network access is needed to verify the app's logic.

## Deploying (free)

This repo includes `render.yaml` for [Render](https://render.com)'s free tier:

1. Push this repo to GitHub.
2. On Render, choose **New → Blueprint**, point it at your repo (it reads `render.yaml` automatically).
3. When prompted, paste your `GEMINI_API_KEY` (the `SESSION_SECRET` is generated for you).
4. Deploy — you'll get a public URL to put on your resume.

A `Procfile` is also included for Railway/Heroku-style platforms if you prefer those instead.

**Note on free-tier disks:** the SQLite file lives on a small persistent disk (configured in `render.yaml`). Free-tier services may sleep after inactivity and cold-start on the next request — expected and fine for a portfolio demo.

## Troubleshooting

**`429 Too Many Requests` / `limit: 0` on `gemini-2.0-flash`:** Google periodically adjusts which models are in the free tier; `gemini-2.0-flash` has been removed from it. Set `GEMINI_MODEL=gemini-2.5-flash` (or `gemini-2.5-flash-lite`) in `.env`. Free tier limits are modest (~10 requests/minute), which is fine for demos but means rapid back-to-back testing can briefly 429 — wait a few seconds and retry.

**`node:sqlite` errors on startup:** you need Node.js 22.5 or later. Check with `node -v` and upgrade at [nodejs.org](https://nodejs.org) if needed.

**`GEMINI_API_KEY is not set`:** On Windows, check the file is actually named `.env` and not `.env.txt` — enable "File name extensions" in File Explorer's View tab to confirm, since Notepad silently appends `.txt` by default.

## Possible extensions

- Multiplayer mode: two students debate each other, AI judges
- Export report as PDF instead of Markdown
- Move sessions to a persistent store (e.g. `connect-sqlite3`) for multi-instance deployments
- Configurable round count per debate
- Swap in a paid model (OpenAI, Claude, or a higher Gemini tier) by editing `debateEngine.js` only — the rest of the app is provider-agnostic

## Resume bullet points

Feel free to adapt these:

- Designed and built **The Rostrum**, a full-stack AI debate-training web app (Node.js, Express, Google Gemini API) with authentication, a real SQLite database, and streaming AI responses, enabling students to practice argumentation against an LLM opponent that rebuts and scores their reasoning in real time.
- Implemented **retrieval-augmented grounding**: before each debate, the app retrieves real background facts via Gemini's search-grounding tool so AI arguments are anchored in verifiable information rather than pure generation.
- Designed a **prompt-injection defense layer** that detects instruction-override attempts in user input and neutralizes them before they reach the model, with dedicated automated tests for the failure mode.
- Built **adaptive difficulty**: the AI opponent automatically escalates or eases off based on the student's rolling performance, implemented as pure, independently unit-tested logic.
- Architected structured LLM output using **Gemini function calling** for reliable four-dimension scoring, deliberately separated from **streamed plain-text generation** for rebuttals — since structured tool-call output can't be safely streamed mid-generation.
- Wrote a **26-test Jest/Supertest suite** covering auth, sessions, the full debate lifecycle, and failure handling, with the AI layer mocked for fully offline, deterministic CI runs.
- Chose **zero-native-dependency infrastructure** throughout (Node's built-in `node:sqlite`, pure-JS `bcryptjs`) specifically to avoid the native-compilation failures common with drivers like `better-sqlite3` on student/CI machines.
- Prepared the app for **one-click free-tier deployment** (Render blueprint + Procfile) with a live public demo link.

## License

MIT — free to use for coursework, portfolios, and interviews.
