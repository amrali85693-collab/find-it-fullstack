# Find It — University Lost & Found
**Team: Seekers**

Core flow: **Lost → Search → Found → Match → Claim → Verify → Return**.

## Status: Working full-stack app, tested end-to-end

Frontend and backend are connected and run against a real PostgreSQL database.
Two independent automated suites, run live in this environment, are both green:

- `backend/test/e2e.sh` — **69/69 passing** — auth, ownership/BOLA, SQLi resistance, image upload validation, the full claim→matched→return status lifecycle (including race-safety and duplicate/invalid-transition guards), matching, reports, admin.
- `backend/test/integration_frontend_contract.mjs` — **31/31 passing** — replays the frontend's exact `fetch`/`FormData` calls for the entire user journey: register → login → post lost item w/ photo → post found item → search/filter → claim → owner approves → item becomes "matched" → owner marks returned → report a post → admin reviews reports/users.

## Features
- Auth: register/login (JWT + bcrypt), role-based (student/admin)
- Post lost/found items with category, date, description, photo upload
- Search + filter (type, category, status) with pagination
- Item detail: contact info gated behind sign-in, "possible match" suggestions for the poster, claim/approve/reject flow, report-a-post
- Claim lifecycle: `active → matched → returned`, with duplicate-claim and re-decide guards, auto-rejecting competing claims once one is approved
- **My Items / My Claims** panel (real API data)
- **Admin** panel: overview stats, reports queue, user role management

## Run it locally

**1. Database**
```bash
sudo service postgresql start
sudo -u postgres psql -c "CREATE USER finduser WITH PASSWORD 'findpass';"
sudo -u postgres psql -c "CREATE DATABASE find_it OWNER finduser;"
sudo -u postgres psql -d find_it -c "GRANT ALL ON SCHEMA public TO finduser;"
```

**2. Backend**
```bash
cd backend
cp .env.example .env
npm install
npm run migrate
npm start          # http://localhost:4000
```

**3. Frontend**
```bash
cd frontend
python3 -m http.server 5173      # http://localhost:5173
```

Open `http://localhost:5173`.

## Deployment

The codebase is already environment-driven — nothing to refactor before deploying:

- **Backend never hardcodes a DB host.** `src/db/pool.js` reads `DATABASE_URL` only. Point it at any managed Postgres (Render, Railway, RDS, Supabase, etc.).
- **Frontend never hardcodes the API host.** `script.js` reads `window.FIND_IT_API_BASE`, falling back to `http://localhost:4000` only for local dev. Set it before `script.js` loads:
  ```html
  <script>window.FIND_IT_API_BASE = 'https://api.yourdomain.com';</script>
  <script src="script.js"></script>
  ```
- **CORS is environment-driven.** `CLIENT_ORIGIN` in `.env` is passed straight into the `cors()` middleware. Set it to your real frontend origin in production — the `*` in `.env.example` is for local dev only and should not be used in production.

### Required backend environment variables
| Variable | Purpose | Production note |
|---|---|---|
| `PORT` | Port Express listens on | Most PaaS providers inject this — read it if provided |
| `NODE_ENV` | `production` in prod | Enables no special behavior yet beyond convention, but set it |
| `CLIENT_ORIGIN` | CORS allow-list | Set to your deployed frontend's exact origin, not `*` |
| `DATABASE_URL` | Postgres connection string | Use your managed Postgres provider's connection string (include `?sslmode=require` if the provider needs it — `pool.js` passes the string through as-is, so append SSL params there if required) |
| `JWT_SECRET` | Signs auth tokens | **Generate a new long random value** — do not reuse the dev value from `.env.example` |
| `JWT_EXPIRES_IN` | Token lifetime | `7d` is a reasonable default |
| `MAX_UPLOAD_MB` | Image upload size cap | `5` by default |
| `UPLOAD_DIR` | Where uploaded images are written | See storage note below |

### Storage note (read before deploying)
Uploaded images are written to local disk (`backend/uploads/`) and served via `/uploads/*`. This works for a **single, persistently-running instance with a persistent disk** (e.g. a Render/Railway service with a mounted volume, or a traditional VPS). It will **not** survive on platforms with an ephemeral filesystem (e.g. serverless functions, or containers that get recycled) — uploaded photos would disappear on restart/redeploy. If you deploy to an ephemeral platform, swap `middleware/upload.js`'s disk storage for an object-storage backend (S3-compatible) before going live; that swap is isolated to that one file.

### Production commands
```bash
# Backend
cd backend
npm ci --omit=dev        # or: npm install --omit=dev
npm run migrate          # run once per new database
npm start

# Frontend — no build step; it's static HTML/CSS/JS.
# Serve frontend/ from any static host (Netlify, Vercel static, S3+CloudFront, nginx, etc.)
# Set window.FIND_IT_API_BASE to your backend's public URL before script.js loads (see above).
```

### Pre-deploy checklist
- [ ] Provision managed PostgreSQL, set `DATABASE_URL`
- [ ] Run `npm run migrate` against that database once
- [ ] Generate a fresh, long, random `JWT_SECRET` — do not reuse any value from this repo
- [ ] Set `CLIENT_ORIGIN` to the exact deployed frontend origin (not `*`)
- [ ] Decide on image storage: persistent disk vs. object storage (see Storage note)
- [ ] Set `window.FIND_IT_API_BASE` in the deployed `index.html` to the backend's public URL
- [ ] Confirm the backend is served over HTTPS in production (required for a real `Authorization: Bearer` token to be safe in transit)

## Known limitations (honest, not hidden)
- **No automated browser test.** This sandbox can't download a headless Chromium (network is allow-listed to package registries only). Verified via a Node script issuing the frontend's identical `fetch`/`FormData` calls (see the contract test above) plus manual code review. Recommend one manual click-through before a public demo.
- Local disk image storage as described above — fine for a single persistent instance, not for ephemeral/serverless hosting without the S3 swap.
- No Docker Compose file yet (not required for the deploy path above, but would simplify local setup further).
- No automated CI pipeline — tests are run manually via the two scripts in `backend/test/`.

## Project layout
```
frontend/   index.html, style.css, script.js
backend/
  src/
    app.js, server.js
    routes/, controllers/, middleware/, utils/
    db/migrations/001_init.sql
  test/e2e.sh                              (backend API test suite — 69 checks)
  test/integration_frontend_contract.mjs   (frontend↔backend contract test — 31 checks)
  .env.example
```
