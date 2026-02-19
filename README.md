# Lab Paper Tracker (Shared Server Mode)

Paper-reading tracker for Hasegawa Laboratory with shared data across users/devices.

## What This Version Provides

- Shared multi-user data via server API (not browser-only storage)
- Join/continue with name + email
- One-time objective setting with progress + countdown
- Paper add/edit/delete (owner only)
- Team leaderboard, member profiles, and collaboration snapshot
- Search + pagination for paper records

## Tech Stack

- Frontend: HTML, CSS, JavaScript
- Backend: Node.js + Express
- Data store: `data/store.json` on server

## Local Run

1. Install dependencies:

```bash
npm install
```

2. Start server:

```bash
npm start
```

3. Open:

- `http://localhost:3000`

## Important for Shared Internet Use

To share data across users/devices, everyone must access the **same deployed server**.

### Deployment Options

Use a platform that supports Node servers:

- Render (Web Service)
- Railway
- Fly.io
- VPS (Ubuntu + PM2/Nginx)

### Persistence Requirement

This app stores data in `data/store.json`.

- If your host has ephemeral filesystem, data can reset on restart/redeploy.
- Use persistent disk/volume, or replace file storage with managed DB.
- You can set `DATA_DIR` env var to point to mounted persistent storage path.

## Project Structure

- `server.js`: API + static file hosting
- `app.js`: frontend UI logic and API integration
- `index.html`, `styles.css`: UI
- `data/store.json`: shared persisted data file

## API Summary

- `GET /api/state`
- `POST /api/join`
- `POST /api/objectives`
- `POST /api/papers`
- `PUT /api/papers/:id`
- `DELETE /api/papers/:id`
- `DELETE /api/users/:uid`

## Security Note

Current login is lightweight (name/email, no password).
For stricter access control, add real authentication (OAuth/password/JWT) before production use.
