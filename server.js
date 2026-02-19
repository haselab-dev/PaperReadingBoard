const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

app.use(express.json());

ensureStoreFile();
let store = readStore();

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get("/api/state", (_req, res) => {
  res.json(publicState());
});

app.post("/api/join", (req, res) => {
  const displayName = String(req.body?.displayName || "").trim();
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();

  if (!displayName) {
    return res.status(400).json({ error: "Display name is required." });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Valid email is required." });
  }

  const existing = Object.values(store.users).find((u) => String(u.email || "").toLowerCase() === email);
  if (existing) {
    existing.displayName = displayName;
    existing.updatedAt = new Date().toISOString();
    persist();
    return res.json({ user: existing });
  }

  const uid = createId();
  const user = {
    uid,
    displayName,
    email,
    joinedAt: new Date().toISOString(),
  };
  store.users[uid] = user;
  persist();
  return res.status(201).json({ user });
});

app.post("/api/objectives", (req, res) => {
  const uid = String(req.body?.uid || "").trim();
  const targetPapers = Number(req.body?.targetPapers);
  const startDate = String(req.body?.startDate || "").trim();
  const endDate = String(req.body?.endDate || "").trim();

  if (!uid || !store.users[uid]) {
    return res.status(400).json({ error: "Valid uid is required." });
  }
  if (!Number.isFinite(targetPapers) || targetPapers < 1) {
    return res.status(400).json({ error: "Target papers must be at least 1." });
  }
  if (!isDateRangeValid(startDate, endDate)) {
    return res.status(400).json({ error: "Invalid start/end dates." });
  }
  if (store.objectives[uid]) {
    return res.status(409).json({ error: "Objective is already set and cannot be changed." });
  }

  const objective = {
    uid,
    targetPapers,
    startDate,
    endDate,
    createdAt: new Date().toISOString(),
  };
  store.objectives[uid] = objective;
  persist();
  return res.status(201).json({ objective });
});

app.post("/api/papers", (req, res) => {
  const uid = String(req.body?.uid || "").trim();
  const paperTitle = String(req.body?.paperTitle || "").trim();
  const paperUrl = String(req.body?.paperUrl || "").trim();
  const memoUrl = String(req.body?.memoUrl || "").trim();
  const readingMinutes = Number(req.body?.readingMinutes);

  if (!uid || !store.users[uid]) {
    return res.status(400).json({ error: "Valid uid is required." });
  }
  if (!store.objectives[uid]) {
    return res.status(400).json({ error: "Objective must be set before adding papers." });
  }
  if (!paperTitle) {
    return res.status(400).json({ error: "Paper title is required." });
  }
  if (!isWebUrl(paperUrl) || !isWebUrl(memoUrl)) {
    return res.status(400).json({ error: "Paper URL and memo URL must be valid HTTP/HTTPS links." });
  }
  if (!Number.isFinite(readingMinutes) || readingMinutes <= 0) {
    return res.status(400).json({ error: "Reading time must be a positive number." });
  }

  const paper = {
    id: createId(),
    uid,
    userName: store.users[uid].displayName || store.users[uid].email || "Unknown",
    paperTitle,
    paperUrl,
    readingMinutes,
    memoUrl,
    readAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  store.papers.push(paper);
  persist();
  return res.status(201).json({ paper });
});

app.put("/api/papers/:id", (req, res) => {
  const paperId = String(req.params.id || "").trim();
  const uid = String(req.body?.uid || "").trim();
  const paperTitle = String(req.body?.paperTitle || "").trim();
  const paperUrl = String(req.body?.paperUrl || "").trim();
  const memoUrl = String(req.body?.memoUrl || "").trim();
  const readingMinutes = Number(req.body?.readingMinutes);

  const idx = store.papers.findIndex((p) => p.id === paperId);
  if (idx < 0) {
    return res.status(404).json({ error: "Paper not found." });
  }
  if (store.papers[idx].uid !== uid) {
    return res.status(403).json({ error: "You can edit only your own paper records." });
  }
  if (!paperTitle) {
    return res.status(400).json({ error: "Paper title is required." });
  }
  if (!isWebUrl(paperUrl) || !isWebUrl(memoUrl)) {
    return res.status(400).json({ error: "Paper URL and memo URL must be valid HTTP/HTTPS links." });
  }
  if (!Number.isFinite(readingMinutes) || readingMinutes <= 0) {
    return res.status(400).json({ error: "Reading time must be a positive number." });
  }

  store.papers[idx] = {
    ...store.papers[idx],
    paperTitle,
    paperUrl,
    memoUrl,
    readingMinutes,
    userName: store.users[uid]?.displayName || store.users[uid]?.email || store.papers[idx].userName,
    updatedAt: new Date().toISOString(),
  };
  persist();
  return res.json({ paper: store.papers[idx] });
});

app.delete("/api/papers/:id", (req, res) => {
  const paperId = String(req.params.id || "").trim();
  const uid = String(req.body?.uid || "").trim();

  const idx = store.papers.findIndex((p) => p.id === paperId);
  if (idx < 0) {
    return res.status(404).json({ error: "Paper not found." });
  }
  if (store.papers[idx].uid !== uid) {
    return res.status(403).json({ error: "You can delete only your own paper records." });
  }

  store.papers.splice(idx, 1);
  persist();
  return res.status(204).send();
});

app.delete("/api/users/:uid", (req, res) => {
  const uid = String(req.params.uid || "").trim();
  const requestUid = String(req.body?.requestUid || "").trim();

  if (!uid || !store.users[uid]) {
    return res.status(404).json({ error: "User not found." });
  }
  if (uid !== requestUid) {
    return res.status(403).json({ error: "You can remove only your own account." });
  }

  delete store.users[uid];
  delete store.objectives[uid];
  store.papers = store.papers.filter((p) => p.uid !== uid);
  persist();

  return res.status(204).send();
});

app.use(express.static(__dirname));

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

function publicState() {
  return {
    users: Object.values(store.users),
    papers: store.papers,
    objectives: store.objectives,
  };
}

function ensureStoreFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(
      STORE_FILE,
      JSON.stringify({ users: {}, papers: [], objectives: {} }, null, 2),
      "utf8"
    );
  }
}

function readStore() {
  try {
    const text = fs.readFileSync(STORE_FILE, "utf8");
    const parsed = JSON.parse(text || "{}");
    return {
      users: parsed.users && typeof parsed.users === "object" ? parsed.users : {},
      papers: Array.isArray(parsed.papers) ? parsed.papers : [],
      objectives: parsed.objectives && typeof parsed.objectives === "object" ? parsed.objectives : {},
    };
  } catch {
    return { users: {}, papers: [], objectives: {} };
  }
}

function persist() {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

function createId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isWebUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isDateRangeValid(startDate, endDate) {
  const s = new Date(startDate);
  const e = new Date(endDate);
  return !Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && s <= e;
}
