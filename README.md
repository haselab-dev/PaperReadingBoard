# Lab Paper Tracker (Shared + Decoupled Persistence)

Paper-reading tracker for Hasegawa Laboratory with shared data across users/devices.

## Goal for Railway Redeploy Safety

This app now supports **decoupled persistence**:

- App server can be redeployed any time.
- Data can live in an **external PostgreSQL database** that is independent of Railway app runtime.
- If `DATABASE_URL` is configured, data is not tied to server local filesystem.

## Stack

- Frontend: HTML, CSS, JavaScript
- Backend: Node.js + Express
- Persistence:
  - Preferred: PostgreSQL via `DATABASE_URL` (decoupled, persistent)
  - Fallback: local JSON file (`data/store.json`)

## Quick Start (Local)

1. Install dependencies:

```bash
npm install
```

2. (Optional) configure `.env` from `.env.example`

3. Start server:

```bash
npm start
```

4. Open:

- `http://localhost:3000`

## Railway Deployment with Decoupled Data

### Recommended Architecture

- Deploy this app on Railway.
- Use an **external Postgres provider** (Neon, Supabase, Aiven, ElephantSQL alternatives, etc.).
- Set Railway environment variable:
  - `DATABASE_URL=<external postgres connection string>`

This ensures app redeploy/restart does not wipe data.

### One-Time Migration of Existing Local File Data

If you already have data in `data/store.json` and want to move it into Postgres:

1. Set `DATABASE_URL` to your external Postgres.
2. Set `BOOTSTRAP_FROM_FILE=true` for one deployment.
3. Start the server once; it imports file data only when DB is empty.
4. Remove `BOOTSTRAP_FROM_FILE` (or set it to `false`) after migration.

### Notes

- The server auto-creates required tables at startup.
- No manual migration step is required for first run.
- If your database requires custom SSL settings, set provider-appropriate connection params.

## Environment Variables

- `DATABASE_URL`
  - When set, PostgreSQL storage is used.
- `DATA_DIR`
  - Used only when `DATABASE_URL` is not set.
- `BOOTSTRAP_FROM_FILE`
  - Optional one-time migration switch from `data/store.json` to Postgres.
- `PORT`
  - Server port (default `3000`).

See `.env.example`.

## API Endpoints

- `GET /api/health`
- `GET /api/state`
- `POST /api/join`
- `POST /api/objectives`
- `POST /api/papers`
- `PUT /api/papers/:id`
- `DELETE /api/papers/:id`
- `DELETE /api/users/:uid`

## Security Note

Current login is lightweight (name/email only).
For production security, add real authentication/authorization (OAuth/JWT/session hardening).
