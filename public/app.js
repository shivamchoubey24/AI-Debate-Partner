// app.js — vanilla JS SPA logic for The Rostrum

const state = {
  user: null,
  authMode: "login", // or "signup"
  selectedTopic: null,
  stance: null,
  difficulty: null,
  debate: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function showView(name) {
  ["auth", "setup", "debate", "report", "history", "shared"].forEach((v) => {
    $(`#view-${v}`).hidden = v !== name;
  });
}

function toast(msg, isError = true) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  t.style.background = isError ? "var(--crimson)" : "var(--sage)";
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => (t.hidden = true), 4000);
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** Streams an NDJSON POST response, calling onEvent(obj) for each parsed line. */
async function apiStream(path, body, onEvent) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // last partial line stays in buffer
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line));
      } catch {
        // ignore malformed line
      }
    }
  }
  if (buffer.trim()) {
    try { onEvent(JSON.parse(buffer)); } catch { /* ignore */ }
  }
}

/* ======================================================================
   Auth
   ====================================================================== */

function renderNav() {
  const nav = $("#mastNav");
  if (state.user) {
    nav.innerHTML = `
      <button class="navbtn" data-view="setup" id="navSetup">New Debate</button>
      <button class="navbtn" data-view="history" id="navHistory">Docket</button>
      <div class="navuser">
        <span class="navuser__name">${escapeHtml(state.user.displayName || state.user.email)}</span>
        <button class="navbtn" id="navLogout">Sign out</button>
      </div>
    `;
    $("#navSetup").addEventListener("click", () => showView("setup"));
    $("#navHistory").addEventListener("click", loadHistory);
    $("#navLogout").addEventListener("click", logout);
  } else {
    nav.innerHTML = `<button class="navbtn" id="navSignIn">Sign in</button>`;
    $("#navSignIn").addEventListener("click", () => {
      state.authMode = "login";
      renderAuthForm();
      showView("auth");
    });
  }
}

function renderAuthForm() {
  const isLogin = state.authMode === "login";
  $("#authEyebrow").textContent = isLogin ? "01 — Sign in" : "01 — Create account";
  $("#authTitle").textContent = isLogin ? "Welcome back" : "Join The Rostrum";
  $("#authSubmitBtn").textContent = isLogin ? "Sign in" : "Create account";
  $("#displayNameField").hidden = isLogin;
  $("#authToggleText").textContent = isLogin ? "Don't have an account?" : "Already have an account?";
  $("#authToggleBtn").textContent = isLogin ? "Create one" : "Sign in";
  $("#authHint").textContent = "";
  $("#authPassword").setAttribute("autocomplete", isLogin ? "current-password" : "new-password");
}

$("#authToggleBtn").addEventListener("click", () => {
  state.authMode = state.authMode === "login" ? "signup" : "login";
  renderAuthForm();
});

$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#authEmail").value.trim();
  const password = $("#authPassword").value;
  const displayName = $("#authDisplayName").value.trim();
  const isLogin = state.authMode === "login";
  const btn = $("#authSubmitBtn");
  btn.disabled = true;

  try {
    const { user } = await api(isLogin ? "/api/auth/login" : "/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(isLogin ? { email, password } : { email, password, displayName }),
    });
    state.user = user;
    renderNav();
    showView("setup");
    loadTopics();
  } catch (err) {
    $("#authHint").textContent = err.message;
    $("#authHint").classList.add("is-error");
  } finally {
    btn.disabled = false;
  }
});

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch { /* ignore */ }
  state.user = null;
  state.debate = null;
  renderNav();
  state.authMode = "login";
  renderAuthForm();
  showView("auth");
}

async function checkAuth() {
  try {
    const { user } = await api("/api/auth/me");
    state.user = user;
  } catch {
    state.user = null;
  }
  renderNav();
}

/* ======================================================================
   Setup view
   ====================================================================== */

async function loadTopics() {
  try {
    const { topics } = await api("/api/topics");
    const grid = $("#topicGrid");
    grid.innerHTML = "";
    topics.forEach((t) => {
      const card = document.createElement("button");
      card.className = "topic-card";
      card.type = "button";
      card.innerHTML = `<span class="topic-card__cat">${t.category}</span><span class="topic-card__text">${escapeHtml(t.topic)}</span>`;
      card.addEventListener("click", () => {
        $$(".topic-card").forEach((c) => c.classList.remove("is-selected"));
        card.classList.add("is-selected");
        state.selectedTopic = t.topic;
        $("#customTopic").value = "";
      });
      grid.appendChild(card);
    });
  } catch (err) {
    toast("Could not load topics: " + err.message);
  }
}

function initPills() {
  document.querySelectorAll(".pillgroup").forEach((group) => {
    group.addEventListener("click", (e) => {
      const btn = e.target.closest(".pill");
      if (!btn) return;
      group.querySelectorAll(".pill").forEach((p) => p.classList.remove("is-selected"));
      btn.classList.add("is-selected");
      if (group.id === "stanceGroup") state.stance = btn.dataset.value;
      if (group.id === "difficultyGroup") state.difficulty = btn.dataset.value;
    });
  });
}

$("#customTopic").addEventListener("input", (e) => {
  if (e.target.value.trim()) {
    $$(".topic-card").forEach((c) => c.classList.remove("is-selected"));
    state.selectedTopic = e.target.value.trim();
  }
});

function setHint(msg, isError) {
  const hint = $("#setupHint");
  hint.textContent = msg;
  hint.classList.toggle("is-error", !!isError);
}

$("#startBtn").addEventListener("click", startDebate);

async function startDebate() {
  const topic = (state.selectedTopic || $("#customTopic").value || "").trim();
  if (!topic) return setHint("Choose a topic or write your own motion.", true);
  if (!state.stance) return setHint("Pick which side you're arguing.", true);
  if (!state.difficulty) return setHint("Pick an opponent difficulty.", true);

  const btn = $("#startBtn");
  btn.disabled = true;
  setHint("Preparing your opponent's opening statement…", false);

  // Build a placeholder debate object we fill in as events stream.
  const draft = { topic, userStance: state.stance, difficulty: state.difficulty, aiStance: state.stance === "for" ? "against" : "for", openingStatement: "", sources: [], rounds: [] };
  showView("debate");
  renderDebateShell(draft);
  const openingBubble = appendStreamingBubble("ai", `Opponent's opening (${draft.aiStance})`);

  try {
    await apiStream("/api/debate/start", { topic, userStance: state.stance, difficulty: state.difficulty }, (evt) => {
      if (evt.type === "status") setStatusBanner(evt.message);
      else if (evt.type === "sources") showSources(evt.sources);
      else if (evt.type === "chunk") appendToStreamingBubble(openingBubble, evt.text);
      else if (evt.type === "error") throw new Error(evt.error);
      else if (evt.type === "done") {
        state.debate = evt.debate;
        finalizeStreamingBubble(openingBubble);
        renderDebate();
      }
    });
    hideStatusBanner();
  } catch (err) {
    setHint(err.message, true);
    showView("setup");
  } finally {
    btn.disabled = false;
  }
}

/* ======================================================================
   Debate view
   ====================================================================== */

function renderDebateShell(d) {
  $("#debateTopic").textContent = d.topic;
  $("#youStanceTag").textContent = `You: ${d.userStance}`;
  $("#aiStanceTag").textContent = `AI: ${d.aiStance}`;
  $("#diffTag").textContent = d.difficulty[0].toUpperCase() + d.difficulty.slice(1);
  $("#transcript").innerHTML = "";
  $("#sourcesBar").hidden = true;
  hideStatusBanner();
  hideNoticeBanner();
  updateMeter([]);
}

function showSources(sources) {
  if (!sources || !sources.length) return;
  $("#sourcesBar").hidden = false;
  $("#sourcesBarText").textContent = sources.join("  ·  ");
  if (state.debate) state.debate.sources = sources;
}

function setStatusBanner(msg) {
  const b = $("#statusBanner");
  b.textContent = msg;
  b.hidden = false;
}
function hideStatusBanner() { $("#statusBanner").hidden = true; }

function showNoticeBanner(msg) {
  const b = $("#noticeBanner");
  b.textContent = "⚠ " + msg;
  b.hidden = false;
}
function hideNoticeBanner() { $("#noticeBanner").hidden = true; }

function appendStreamingBubble(who, label) {
  const el = document.createElement("div");
  el.className = `bubble bubble--${who === "you" ? "you" : "ai"}`;
  el.innerHTML = `<span class="bubble__label">${escapeHtml(label)}</span><span class="bubble__text"></span>`;
  $("#transcript").appendChild(el);
  $("#transcript").scrollTop = $("#transcript").scrollHeight;
  return el;
}
function appendToStreamingBubble(el, text) {
  el.querySelector(".bubble__text").textContent += text;
  $("#transcript").scrollTop = $("#transcript").scrollHeight;
}
function finalizeStreamingBubble(el) {
  const text = el.querySelector(".bubble__text").textContent;
  const speakBtn = document.createElement("button");
  speakBtn.className = "speakbtn";
  speakBtn.type = "button";
  speakBtn.textContent = "🔊 Listen";
  speakBtn.addEventListener("click", () => speak(text));
  el.appendChild(speakBtn);
}

function appendScoredBubble(round) {
  const el = document.createElement("div");
  el.className = "bubble bubble--you";
  el.innerHTML = `<span class="bubble__label">You — round ${round.round}</span>${escapeHtml(round.userArgument)}
    <div class="bubble__score">Logic ${round.userScore.logic} · Evidence ${round.userScore.evidence} · Persuasiveness ${round.userScore.persuasiveness} · Clarity ${round.userScore.clarity} — Overall ${round.userScore.overall}/10</div>`;
  $("#transcript").appendChild(el);
  $("#transcript").scrollTop = $("#transcript").scrollHeight;
}

function renderDebate() {
  const d = state.debate;
  renderDebateShell(d);
  if (d.sources && d.sources.length) showSources(d.sources);

  const opening = appendStreamingBubble("ai", `Opponent's opening (${d.aiStance})`);
  appendToStreamingBubble(opening, d.openingStatement);
  finalizeStreamingBubble(opening);

  d.rounds.forEach((r) => {
    appendScoredBubble(r);
    const reb = appendStreamingBubble("ai", `Opponent rebuttal — round ${r.round}`);
    appendToStreamingBubble(reb, r.aiRebuttal);
    finalizeStreamingBubble(reb);
  });

  updateRoundUi(d.rounds.length, d.difficulty);
  updateMeter(d.rounds);
  if (d.rounds.length) $("#coachFeedback").textContent = d.rounds[d.rounds.length - 1].feedback;
}

function updateRoundUi(used, difficulty) {
  $("#roundCounter").textContent = `Round ${Math.min(used + 1, 5)} of 5${used >= 5 ? " — max reached" : ""}`;
  $("#submitArgBtn").disabled = used >= 5;
  $("#userArgumentInput").disabled = used >= 5;
  if (difficulty) $("#diffTag").textContent = difficulty[0].toUpperCase() + difficulty.slice(1);
}

$("#submitArgBtn").addEventListener("click", submitArgument);
$("#userArgumentInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitArgument();
});

async function submitArgument() {
  const input = $("#userArgumentInput");
  const text = input.value.trim();
  if (!text) return toast("Write an argument before submitting.");
  const btn = $("#submitArgBtn");
  btn.disabled = true;
  input.disabled = true;
  btn.textContent = "Thinking…";
  hideNoticeBanner();

  const userArgument = text;
  input.value = "";

  const pendingRound = { round: state.debate.rounds.length + 1, userArgument, userScore: null };
  const userBubble = document.createElement("div");
  userBubble.className = "bubble bubble--you";
  userBubble.innerHTML = `<span class="bubble__label">You — round ${pendingRound.round}</span>${escapeHtml(userArgument)}`;
  $("#transcript").appendChild(userBubble);
  $("#transcript").scrollTop = $("#transcript").scrollHeight;

  const rebuttalBubble = appendStreamingBubble("ai", `Opponent rebuttal — round ${pendingRound.round}`);

  try {
    let finalRound = null;
    await apiStream("/api/debate/turn", { debateId: state.debate.id, userArgument }, (evt) => {
      if (evt.type === "notice") showNoticeBanner(evt.message);
      else if (evt.type === "status") setStatusBanner(evt.message);
      else if (evt.type === "chunk") appendToStreamingBubble(rebuttalBubble, evt.text);
      else if (evt.type === "difficultyChange") {
        toast(`Opponent difficulty adjusted: ${evt.previous} → ${evt.difficulty}`, false);
      } else if (evt.type === "error") throw new Error(evt.error);
      else if (evt.type === "done") {
        finalRound = evt.round;
        state.debate.rounds.push(evt.round);
        state.debate.difficulty = evt.difficulty;
      }
    });
    hideStatusBanner();
    finalizeStreamingBubble(rebuttalBubble);
    if (finalRound) {
      userBubble.innerHTML += `<div class="bubble__score">Logic ${finalRound.userScore.logic} · Evidence ${finalRound.userScore.evidence} · Persuasiveness ${finalRound.userScore.persuasiveness} · Clarity ${finalRound.userScore.clarity} — Overall ${finalRound.userScore.overall}/10</div>`;
      updateRoundUi(state.debate.rounds.length, state.debate.difficulty);
      updateMeter(state.debate.rounds);
      $("#coachFeedback").textContent = finalRound.feedback;
    }
  } catch (err) {
    toast(err.message);
    rebuttalBubble.remove();
  } finally {
    btn.disabled = state.debate.rounds.length >= 5;
    input.disabled = state.debate.rounds.length >= 5;
    btn.textContent = "Submit argument";
  }
}

$("#endDebateBtn").addEventListener("click", endDebate);

async function endDebate() {
  if (!state.debate || state.debate.rounds.length === 0) return toast("Add at least one argument first.");
  const btn = $("#endDebateBtn");
  btn.disabled = true;
  btn.textContent = "Scoring…";
  try {
    const { debate } = await api("/api/debate/end", { method: "POST", body: JSON.stringify({ debateId: state.debate.id }) });
    state.debate = debate;
    renderReport(debate);
    showView("report");
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "End & get report";
  }
}

/* ---------------- Voice input/output ---------------- */

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
let listening = false;

if (SpeechRecognitionImpl) {
  recognizer = new SpeechRecognitionImpl();
  recognizer.continuous = false;
  recognizer.interimResults = false;
  recognizer.lang = "en-US";

  recognizer.addEventListener("result", (e) => {
    const transcript = Array.from(e.results).map((r) => r[0].transcript).join(" ");
    const input = $("#userArgumentInput");
    input.value = (input.value ? input.value + " " : "") + transcript;
  });
  recognizer.addEventListener("end", () => {
    listening = false;
    $("#micBtn").classList.remove("is-listening");
  });
  recognizer.addEventListener("error", () => {
    listening = false;
    $("#micBtn").classList.remove("is-listening");
    toast("Couldn't hear that — check microphone permissions.");
  });
} else {
  $("#micBtn").title = "Voice input isn't supported in this browser";
}

$("#micBtn").addEventListener("click", () => {
  if (!recognizer) return toast("Voice input isn't supported in this browser.");
  if (listening) {
    recognizer.stop();
    return;
  }
  listening = true;
  $("#micBtn").classList.add("is-listening");
  recognizer.start();
});

function speak(text) {
  if (!window.speechSynthesis) return toast("Speech playback isn't supported in this browser.");
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1.0;
  window.speechSynthesis.speak(utter);
}

/* ======================================================================
   Rhetoric Meter (SVG gauge)
   ====================================================================== */

function updateMeter(rounds) {
  const svg = $("#meter");
  const avg = rounds.length ? rounds.reduce((s, r) => s + r.userScore.overall, 0) / rounds.length : 0;

  const cx = 110, cy = 110, r = 90;
  const startAngle = Math.PI, endAngle = 0;
  const frac = Math.max(0, Math.min(1, avg / 10));
  const valueAngle = startAngle - frac * Math.PI;
  const arcPoint = (angle) => `${cx + r * Math.cos(angle)},${cy - r * Math.sin(angle)}`;
  const bgArc = `M ${arcPoint(startAngle)} A ${r} ${r} 0 0 1 ${arcPoint(endAngle)}`;
  const valueArc = `M ${arcPoint(startAngle)} A ${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${arcPoint(valueAngle)}`;
  const needleLen = r - 14;
  const needleX = cx + needleLen * Math.cos(valueAngle);
  const needleY = cy - needleLen * Math.sin(valueAngle);

  svg.innerHTML = `
    <path d="${bgArc}" fill="none" stroke="#333B5C" stroke-width="14" stroke-linecap="round" />
    <path d="${valueArc}" fill="none" stroke="#C9A24B" stroke-width="14" stroke-linecap="round" />
    <line x1="${cx}" y1="${cy}" x2="${needleX}" y2="${needleY}" stroke="#EDE6D6" stroke-width="2.5" stroke-linecap="round" />
    <circle cx="${cx}" cy="${cy}" r="6" fill="#C9A24B" />
  `;
  $("#meterScore").textContent = rounds.length ? avg.toFixed(1) + " / 10" : "—";

  const breakdown = $("#meterBreakdown");
  if (!rounds.length) { breakdown.innerHTML = ""; return; }
  const dims = ["logic", "evidence", "persuasiveness", "clarity"];
  const avgOf = (k) => (rounds.reduce((s, r) => s + r.userScore[k], 0) / rounds.length).toFixed(1);
  breakdown.innerHTML = dims.map((k) => `<div><span>${k[0].toUpperCase() + k.slice(1)}</span><span>${avgOf(k)}</span></div>`).join("");
}

/* ======================================================================
   Report view
   ====================================================================== */

function renderReport(d) {
  const s = d.summary;
  $("#reportTopic").textContent = d.topic;
  $("#reportScoreNum").textContent = s.overallScore.toFixed(1);
  $("#reportVerdict").textContent = s.verdict;
  $("#reportStrengths").innerHTML = s.strengths.map((x) => `<li>${escapeHtml(x)}</li>`).join("");
  $("#reportImprovements").innerHTML = s.improvements.map((x) => `<li>${escapeHtml(x)}</li>`).join("");
}

$("#newDebateFromReportBtn").addEventListener("click", () => {
  state.debate = null;
  state.selectedTopic = null;
  state.stance = null;
  state.difficulty = null;
  $("#customTopic").value = "";
  $$(".pill").forEach((p) => p.classList.remove("is-selected"));
  $$(".topic-card").forEach((c) => c.classList.remove("is-selected"));
  setHint("", false);
  showView("setup");
});

$("#downloadTranscriptBtn").addEventListener("click", () => {
  const d = state.debate;
  let md = `# Debate Transcript\n\n**Motion:** ${d.topic}\n\n**You argued:** ${d.userStance}  \n**AI argued:** ${d.aiStance}  \n**Difficulty:** ${d.difficulty}\n\n`;
  if (d.sources && d.sources.length) md += `**Grounding facts:**\n${d.sources.map((s) => `- ${s}`).join("\n")}\n\n`;
  md += `---\n\n### Opponent's opening\n${d.openingStatement}\n\n`;
  d.rounds.forEach((r) => {
    md += `### Round ${r.round}\n**You:** ${r.userArgument}\n\n*Scores — Logic ${r.userScore.logic}, Evidence ${r.userScore.evidence}, Persuasiveness ${r.userScore.persuasiveness}, Clarity ${r.userScore.clarity} (Overall ${r.userScore.overall}/10)*\n*Coach note: ${r.feedback}*\n\n**AI rebuttal:** ${r.aiRebuttal}\n\n`;
  });
  if (d.summary) {
    md += `---\n\n## Final Report\n\n**Overall score:** ${d.summary.overallScore}/10\n\n${d.summary.verdict}\n\n**Strengths:**\n${d.summary.strengths.map((x) => `- ${x}`).join("\n")}\n\n**Areas to sharpen:**\n${d.summary.improvements.map((x) => `- ${x}`).join("\n")}\n`;
  }
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `debate-${d.id}.md`;
  a.click();
  URL.revokeObjectURL(url);
});

$("#shareBtn").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}?share=${state.debate.id}`;
  try {
    await navigator.clipboard.writeText(url);
    toast("Share link copied to clipboard.", false);
  } catch {
    toast(url, false);
  }
});

/* ======================================================================
   Public shared view (no auth required)
   ====================================================================== */

async function loadSharedView(id) {
  showView("shared");
  try {
    const { debate } = await api(`/api/share/${id}`);
    $("#sharedTopic").textContent = debate.topic;
    $("#sharedScoreNum").textContent = debate.summary.overallScore.toFixed(1);
    $("#sharedVerdict").textContent = debate.summary.verdict;
    $("#sharedStrengths").innerHTML = debate.summary.strengths.map((x) => `<li>${escapeHtml(x)}</li>`).join("");
    $("#sharedImprovements").innerHTML = debate.summary.improvements.map((x) => `<li>${escapeHtml(x)}</li>`).join("");
  } catch (err) {
    $("#sharedTopic").textContent = "This shared debate could not be found.";
    $("#sharedVerdict").textContent = "";
  }
}

$("#tryItYourselfBtn").addEventListener("click", () => {
  history.replaceState({}, "", location.pathname);
  init();
});

/* ======================================================================
   History view
   ====================================================================== */

async function loadHistory() {
  showView("history");
  const list = $("#historyList");
  list.innerHTML = `<p class="empty-state">Loading…</p>`;
  try {
    const { debates } = await api("/api/history");
    if (!debates.length) {
      list.innerHTML = `<p class="empty-state">No debates yet. Start one from "New Debate".</p>`;
      return;
    }
    list.innerHTML = "";
    debates.forEach((d) => {
      const item = document.createElement("div");
      item.className = "history-item";
      item.innerHTML = `
        <div>
          <div class="history-item__topic">${escapeHtml(d.topic)}</div>
          <div class="history-item__meta">${d.userStance.toUpperCase()} · ${d.difficulty} · ${d.rounds} round${d.rounds === 1 ? "" : "s"} · ${new Date(d.createdAt).toLocaleString()}</div>
        </div>
        <div class="history-item__score">${d.overallScore != null ? d.overallScore.toFixed(1) : "—"}</div>
      `;
      item.addEventListener("click", async () => {
        try {
          const { debate } = await api(`/api/debate/${d.id}`);
          state.debate = debate;
          if (debate.summary) { renderReport(debate); showView("report"); }
          else { renderDebate(); showView("debate"); }
        } catch (err) {
          toast(err.message);
        }
      });
      list.appendChild(item);
    });
  } catch (err) {
    list.innerHTML = `<p class="empty-state">Could not load history: ${escapeHtml(err.message)}</p>`;
  }
}

/* ======================================================================
   Init
   ====================================================================== */

async function init() {
  initPills();
  renderAuthForm();

  const params = new URLSearchParams(location.search);
  const shareId = params.get("share");
  if (shareId) {
    renderNav();
    await loadSharedView(shareId);
    return;
  }

  await checkAuth();
  if (state.user) {
    showView("setup");
    loadTopics();
  } else {
    showView("auth");
  }
}

init();
