const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const DATABASE_URL = process.env.DATABASE_URL;
const BOOTSTRAP_FROM_FILE = process.env.BOOTSTRAP_FROM_FILE === "true";

app.use(express.json());

let storage = null;

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), storage: DATABASE_URL ? "postgres" : "file" });
});

app.get("/api/state", asyncHandler(async (_req, res) => {
  res.json(await storage.getState());
}));

app.post("/api/join", asyncHandler(async (req, res) => {
  const displayName = String(req.body?.displayName || "").trim();
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();

  if (!displayName) {
    throw new HttpError(400, "Display name is required.");
  }
  if (!isValidEmail(email)) {
    throw new HttpError(400, "Valid email is required.");
  }

  const user = await storage.joinUser({ displayName, email });
  res.status(user.wasCreated ? 201 : 200).json({ user: user.data });
}));

app.post("/api/objectives", asyncHandler(async (req, res) => {
  const uid = String(req.body?.uid || "").trim();
  const targetPapers = Number(req.body?.targetPapers);
  const startDate = String(req.body?.startDate || "").trim();
  const endDate = String(req.body?.endDate || "").trim();

  if (!uid) {
    throw new HttpError(400, "Valid uid is required.");
  }
  if (!Number.isFinite(targetPapers) || targetPapers < 1) {
    throw new HttpError(400, "Target papers must be at least 1.");
  }
  if (!isDateRangeValid(startDate, endDate)) {
    throw new HttpError(400, "Invalid start/end dates.");
  }

  const objective = await storage.createObjective({
    uid,
    targetPapers,
    startDate,
    endDate,
    createdAt: new Date().toISOString(),
  });
  res.status(201).json({ objective });
}));

app.post("/api/papers", asyncHandler(async (req, res) => {
  const uid = String(req.body?.uid || "").trim();
  const paperTitle = String(req.body?.paperTitle || "").trim();
  const paperUrl = String(req.body?.paperUrl || "").trim();
  const memoUrl = String(req.body?.memoUrl || "").trim();
  const readingMinutes = Number(req.body?.readingMinutes);

  if (!uid) {
    throw new HttpError(400, "Valid uid is required.");
  }
  if (!paperTitle) {
    throw new HttpError(400, "Paper title is required.");
  }
  if (!isWebUrl(paperUrl) || !isWebUrl(memoUrl)) {
    throw new HttpError(400, "Paper URL and memo URL must be valid HTTP/HTTPS links.");
  }
  if (!Number.isFinite(readingMinutes) || readingMinutes <= 0) {
    throw new HttpError(400, "Reading time must be a positive number.");
  }

  const now = new Date().toISOString();
  const paper = await storage.createPaper({
    id: createId(),
    uid,
    paperTitle,
    paperUrl,
    readingMinutes,
    memoUrl,
    readAt: now,
    createdAt: now,
  });

  res.status(201).json({ paper });
}));

app.put("/api/papers/:id", asyncHandler(async (req, res) => {
  const paperId = String(req.params.id || "").trim();
  const uid = String(req.body?.uid || "").trim();
  const paperTitle = String(req.body?.paperTitle || "").trim();
  const paperUrl = String(req.body?.paperUrl || "").trim();
  const memoUrl = String(req.body?.memoUrl || "").trim();
  const readingMinutes = Number(req.body?.readingMinutes);

  if (!paperId) {
    throw new HttpError(400, "Paper id is required.");
  }
  if (!uid) {
    throw new HttpError(400, "Valid uid is required.");
  }
  if (!paperTitle) {
    throw new HttpError(400, "Paper title is required.");
  }
  if (!isWebUrl(paperUrl) || !isWebUrl(memoUrl)) {
    throw new HttpError(400, "Paper URL and memo URL must be valid HTTP/HTTPS links.");
  }
  if (!Number.isFinite(readingMinutes) || readingMinutes <= 0) {
    throw new HttpError(400, "Reading time must be a positive number.");
  }

  const paper = await storage.updatePaper({
    id: paperId,
    uid,
    paperTitle,
    paperUrl,
    memoUrl,
    readingMinutes,
    updatedAt: new Date().toISOString(),
  });

  res.json({ paper });
}));

app.delete("/api/papers/:id", asyncHandler(async (req, res) => {
  const paperId = String(req.params.id || "").trim();
  const uid = String(req.body?.uid || "").trim();

  if (!paperId) {
    throw new HttpError(400, "Paper id is required.");
  }
  if (!uid) {
    throw new HttpError(400, "Valid uid is required.");
  }

  await storage.deletePaper({ id: paperId, uid });
  res.status(204).send();
}));

app.delete("/api/users/:uid", asyncHandler(async (req, res) => {
  const uid = String(req.params.uid || "").trim();
  const requestUid = String(req.body?.requestUid || "").trim();

  if (!uid) {
    throw new HttpError(400, "Valid uid is required.");
  }
  if (!requestUid) {
    throw new HttpError(400, "requestUid is required.");
  }

  await storage.deleteUser({ uid, requestUid });
  res.status(204).send();
}));

app.use(express.static(__dirname));

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use((err, _req, res, _next) => {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof HttpError ? err.message : "Internal server error";
  if (!(err instanceof HttpError)) {
    console.error(err);
  }
  res.status(status).json({ error: message });
});

start().catch((err) => {
  console.error("Failed to start server", err);
  process.exit(1);
});

async function start() {
  storage = DATABASE_URL ? createPostgresStorage(DATABASE_URL) : createFileStorage(STORE_FILE, DATA_DIR);
  await storage.init();
  if (DATABASE_URL && BOOTSTRAP_FROM_FILE) {
    await bootstrapPostgresFromFile(storage, STORE_FILE, DATA_DIR);
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT} using ${DATABASE_URL ? "postgres" : "file"} storage`);
  });
}

function createFileStorage(storeFile, dataDir) {
  let store = { users: {}, papers: [], objectives: {} };

  return {
    async init() {
      ensureStoreFile(dataDir, storeFile);
      store = readStoreFile(storeFile);
    },

    async getState() {
      return {
        users: Object.values(store.users),
        papers: store.papers,
        objectives: store.objectives,
      };
    },

    async joinUser({ displayName, email }) {
      const existing = Object.values(store.users).find((u) => String(u.email || "").toLowerCase() === email);

      if (existing) {
        existing.displayName = displayName;
        existing.updatedAt = new Date().toISOString();
        persistStoreFile(storeFile, store);
        return { wasCreated: false, data: existing };
      }

      const uid = createId();
      const user = {
        uid,
        displayName,
        email,
        joinedAt: new Date().toISOString(),
      };
      store.users[uid] = user;
      persistStoreFile(storeFile, store);
      return { wasCreated: true, data: user };
    },

    async createObjective({ uid, targetPapers, startDate, endDate, createdAt }) {
      if (!store.users[uid]) {
        throw new HttpError(400, "Valid uid is required.");
      }
      if (store.objectives[uid]) {
        throw new HttpError(409, "Objective is already set and cannot be changed.");
      }

      const objective = {
        uid,
        targetPapers,
        startDate,
        endDate,
        createdAt,
      };
      store.objectives[uid] = objective;
      persistStoreFile(storeFile, store);
      return objective;
    },

    async createPaper(input) {
      const user = store.users[input.uid];
      if (!user) {
        throw new HttpError(400, "Valid uid is required.");
      }
      if (!store.objectives[input.uid]) {
        throw new HttpError(400, "Objective must be set before adding papers.");
      }

      const paper = {
        ...input,
        userName: user.displayName || user.email || "Unknown",
      };

      store.papers.push(paper);
      persistStoreFile(storeFile, store);
      return paper;
    },

    async updatePaper({ id, uid, paperTitle, paperUrl, memoUrl, readingMinutes, updatedAt }) {
      const idx = store.papers.findIndex((p) => p.id === id);
      if (idx < 0) {
        throw new HttpError(404, "Paper not found.");
      }
      if (store.papers[idx].uid !== uid) {
        throw new HttpError(403, "You can edit only your own paper records.");
      }

      store.papers[idx] = {
        ...store.papers[idx],
        paperTitle,
        paperUrl,
        memoUrl,
        readingMinutes,
        userName: store.users[uid]?.displayName || store.users[uid]?.email || store.papers[idx].userName,
        updatedAt,
      };

      persistStoreFile(storeFile, store);
      return store.papers[idx];
    },

    async deletePaper({ id, uid }) {
      const idx = store.papers.findIndex((p) => p.id === id);
      if (idx < 0) {
        throw new HttpError(404, "Paper not found.");
      }
      if (store.papers[idx].uid !== uid) {
        throw new HttpError(403, "You can delete only your own paper records.");
      }

      store.papers.splice(idx, 1);
      persistStoreFile(storeFile, store);
    },

    async deleteUser({ uid, requestUid }) {
      if (!store.users[uid]) {
        throw new HttpError(404, "User not found.");
      }
      if (uid !== requestUid) {
        throw new HttpError(403, "You can remove only your own account.");
      }

      delete store.users[uid];
      delete store.objectives[uid];
      store.papers = store.papers.filter((p) => p.uid !== uid);
      persistStoreFile(storeFile, store);
    },
  };
}

function createPostgresStorage(databaseUrl) {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  });

  return {
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          uid TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          email TEXT NOT NULL,
          joined_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ
        )
      `);
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users ((LOWER(email)))
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS objectives (
          uid TEXT PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
          target_papers INTEGER NOT NULL CHECK (target_papers > 0),
          start_date DATE NOT NULL,
          end_date DATE NOT NULL,
          created_at TIMESTAMPTZ NOT NULL
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS papers (
          id TEXT PRIMARY KEY,
          uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
          user_name TEXT NOT NULL,
          paper_title TEXT NOT NULL,
          paper_url TEXT NOT NULL,
          reading_minutes INTEGER NOT NULL CHECK (reading_minutes > 0),
          memo_url TEXT NOT NULL,
          read_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS papers_uid_idx ON papers(uid)
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS papers_read_at_idx ON papers(read_at DESC)
      `);
    },

    async getState() {
      const usersRes = await pool.query(
        `SELECT uid, display_name, email, joined_at, updated_at FROM users ORDER BY joined_at ASC`
      );
      const papersRes = await pool.query(
        `SELECT id, uid, user_name, paper_title, paper_url, reading_minutes, memo_url, read_at, created_at, updated_at
         FROM papers
         ORDER BY read_at DESC`
      );
      const objectivesRes = await pool.query(
        `SELECT uid, target_papers, start_date, end_date, created_at FROM objectives`
      );

      const objectives = {};
      for (const row of objectivesRes.rows) {
        objectives[row.uid] = mapObjectiveRow(row);
      }

      return {
        users: usersRes.rows.map(mapUserRow),
        papers: papersRes.rows.map(mapPaperRow),
        objectives,
      };
    },

    async joinUser({ displayName, email }) {
      const existingRes = await pool.query(
        `SELECT uid, display_name, email, joined_at, updated_at FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [email]
      );

      if (existingRes.rowCount > 0) {
        const row = existingRes.rows[0];
        const updatedRes = await pool.query(
          `UPDATE users SET display_name = $1, updated_at = $2 WHERE uid = $3
           RETURNING uid, display_name, email, joined_at, updated_at`,
          [displayName, new Date().toISOString(), row.uid]
        );
        return { wasCreated: false, data: mapUserRow(updatedRes.rows[0]) };
      }

      const uid = createId();
      const now = new Date().toISOString();
      const insertRes = await pool.query(
        `INSERT INTO users (uid, display_name, email, joined_at)
         VALUES ($1, $2, $3, $4)
         RETURNING uid, display_name, email, joined_at, updated_at`,
        [uid, displayName, email, now]
      );

      return { wasCreated: true, data: mapUserRow(insertRes.rows[0]) };
    },

    async createObjective({ uid, targetPapers, startDate, endDate, createdAt }) {
      const userRes = await pool.query(`SELECT uid FROM users WHERE uid = $1 LIMIT 1`, [uid]);
      if (userRes.rowCount === 0) {
        throw new HttpError(400, "Valid uid is required.");
      }

      const insertRes = await pool.query(
        `INSERT INTO objectives (uid, target_papers, start_date, end_date, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (uid) DO NOTHING
         RETURNING uid, target_papers, start_date, end_date, created_at`,
        [uid, targetPapers, startDate, endDate, createdAt]
      );

      if (insertRes.rowCount === 0) {
        throw new HttpError(409, "Objective is already set and cannot be changed.");
      }

      return mapObjectiveRow(insertRes.rows[0]);
    },

    async createPaper(input) {
      const userRes = await pool.query(
        `SELECT uid, display_name, email FROM users WHERE uid = $1 LIMIT 1`,
        [input.uid]
      );
      if (userRes.rowCount === 0) {
        throw new HttpError(400, "Valid uid is required.");
      }

      const objectiveRes = await pool.query(`SELECT uid FROM objectives WHERE uid = $1 LIMIT 1`, [input.uid]);
      if (objectiveRes.rowCount === 0) {
        throw new HttpError(400, "Objective must be set before adding papers.");
      }

      const user = userRes.rows[0];
      const userName = user.display_name || user.email || "Unknown";

      const insertRes = await pool.query(
        `INSERT INTO papers (
          id, uid, user_name, paper_title, paper_url, reading_minutes,
          memo_url, read_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, uid, user_name, paper_title, paper_url, reading_minutes, memo_url, read_at, created_at, updated_at`,
        [
          input.id,
          input.uid,
          userName,
          input.paperTitle,
          input.paperUrl,
          input.readingMinutes,
          input.memoUrl,
          input.readAt,
          input.createdAt,
        ]
      );

      return mapPaperRow(insertRes.rows[0]);
    },

    async updatePaper({ id, uid, paperTitle, paperUrl, memoUrl, readingMinutes, updatedAt }) {
      const existingRes = await pool.query(`SELECT id, uid FROM papers WHERE id = $1 LIMIT 1`, [id]);
      if (existingRes.rowCount === 0) {
        throw new HttpError(404, "Paper not found.");
      }
      if (existingRes.rows[0].uid !== uid) {
        throw new HttpError(403, "You can edit only your own paper records.");
      }

      const userRes = await pool.query(
        `SELECT display_name, email FROM users WHERE uid = $1 LIMIT 1`,
        [uid]
      );
      const userName =
        (userRes.rowCount > 0 && (userRes.rows[0].display_name || userRes.rows[0].email)) || "Unknown";

      const updateRes = await pool.query(
        `UPDATE papers
         SET paper_title = $1,
             paper_url = $2,
             memo_url = $3,
             reading_minutes = $4,
             user_name = $5,
             updated_at = $6
         WHERE id = $7
         RETURNING id, uid, user_name, paper_title, paper_url, reading_minutes, memo_url, read_at, created_at, updated_at`,
        [paperTitle, paperUrl, memoUrl, readingMinutes, userName, updatedAt, id]
      );

      return mapPaperRow(updateRes.rows[0]);
    },

    async deletePaper({ id, uid }) {
      const existingRes = await pool.query(`SELECT id, uid FROM papers WHERE id = $1 LIMIT 1`, [id]);
      if (existingRes.rowCount === 0) {
        throw new HttpError(404, "Paper not found.");
      }
      if (existingRes.rows[0].uid !== uid) {
        throw new HttpError(403, "You can delete only your own paper records.");
      }

      await pool.query(`DELETE FROM papers WHERE id = $1`, [id]);
    },

    async deleteUser({ uid, requestUid }) {
      const existingRes = await pool.query(`SELECT uid FROM users WHERE uid = $1 LIMIT 1`, [uid]);
      if (existingRes.rowCount === 0) {
        throw new HttpError(404, "User not found.");
      }
      if (uid !== requestUid) {
        throw new HttpError(403, "You can remove only your own account.");
      }

      await pool.query(`DELETE FROM users WHERE uid = $1`, [uid]);
    },

    async isEmpty() {
      const usersRes = await pool.query(`SELECT COUNT(*)::int AS count FROM users`);
      const papersRes = await pool.query(`SELECT COUNT(*)::int AS count FROM papers`);
      const objectivesRes = await pool.query(`SELECT COUNT(*)::int AS count FROM objectives`);
      return usersRes.rows[0].count === 0 && papersRes.rows[0].count === 0 && objectivesRes.rows[0].count === 0;
    },

    async seedFromState(state) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        for (const user of Object.values(state.users || {})) {
          await client.query(
            `INSERT INTO users (uid, display_name, email, joined_at, updated_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (uid) DO UPDATE SET
               display_name = EXCLUDED.display_name,
               email = EXCLUDED.email,
               updated_at = EXCLUDED.updated_at`,
            [
              user.uid,
              user.displayName || "Unknown",
              user.email || `${user.uid}@unknown.local`,
              user.joinedAt || new Date().toISOString(),
              user.updatedAt || null,
            ]
          );
        }

        for (const objective of Object.values(state.objectives || {})) {
          await client.query(
            `INSERT INTO objectives (uid, target_papers, start_date, end_date, created_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (uid) DO NOTHING`,
            [
              objective.uid,
              Number(objective.targetPapers) || 1,
              objective.startDate,
              objective.endDate,
              objective.createdAt || new Date().toISOString(),
            ]
          );
        }

        for (const paper of state.papers || []) {
          await client.query(
            `INSERT INTO papers (
              id, uid, user_name, paper_title, paper_url, reading_minutes,
              memo_url, read_at, created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            ON CONFLICT (id) DO NOTHING`,
            [
              paper.id || createId(),
              paper.uid,
              paper.userName || "Unknown",
              paper.paperTitle || "(No title)",
              paper.paperUrl || "https://example.com",
              Number(paper.readingMinutes) || 1,
              paper.memoUrl || "https://example.com",
              paper.readAt || new Date().toISOString(),
              paper.createdAt || new Date().toISOString(),
              paper.updatedAt || null,
            ]
          );
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

async function bootstrapPostgresFromFile(pgStorage, storeFile, dataDir) {
  ensureStoreFile(dataDir, storeFile);
  const fileState = readStoreFile(storeFile);
  const hasData =
    Object.keys(fileState.users || {}).length > 0 ||
    Object.keys(fileState.objectives || {}).length > 0 ||
    (fileState.papers || []).length > 0;

  if (!hasData) {
    return;
  }

  const empty = await pgStorage.isEmpty();
  if (!empty) {
    return;
  }

  await pgStorage.seedFromState(fileState);
  console.log("Bootstrapped PostgreSQL data from local store file.");
}

function mapUserRow(row) {
  return {
    uid: row.uid,
    displayName: row.display_name,
    email: row.email,
    joinedAt: toIso(row.joined_at),
    updatedAt: row.updated_at ? toIso(row.updated_at) : undefined,
  };
}

function mapPaperRow(row) {
  return {
    id: row.id,
    uid: row.uid,
    userName: row.user_name,
    paperTitle: row.paper_title,
    paperUrl: row.paper_url,
    readingMinutes: Number(row.reading_minutes),
    memoUrl: row.memo_url,
    readAt: toIso(row.read_at),
    createdAt: toIso(row.created_at),
    updatedAt: row.updated_at ? toIso(row.updated_at) : undefined,
  };
}

function mapObjectiveRow(row) {
  return {
    uid: row.uid,
    targetPapers: Number(row.target_papers),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    createdAt: toIso(row.created_at),
  };
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function ensureStoreFile(dataDir, storeFile) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(storeFile)) {
    fs.writeFileSync(
      storeFile,
      JSON.stringify({ users: {}, papers: [], objectives: {} }, null, 2),
      "utf8"
    );
  }
}

function readStoreFile(storeFile) {
  try {
    const text = fs.readFileSync(storeFile, "utf8");
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

function persistStoreFile(storeFile, store) {
  fs.writeFileSync(storeFile, JSON.stringify(store, null, 2), "utf8");
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

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
