# EnerTrack

EnerTrack is an energy-audit frontend with a Node.js/Express API and PostgreSQL database.
The existing interface is served at `/` by Express during local development, while its
layout and client-side energy-report presentation remain in `index.html`.

## Requirements

- Node.js 20 or newer and npm.
- PostgreSQL 15 or newer, running locally or on a managed database.
- A database and database user dedicated to EnerTrack.
- A random session secret of at least 32 characters.
- SMTP settings (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`) if users need email-based password reset.

## Local setup

1. Create a PostgreSQL role and database. For example, from `psql` as a database
   administrator:

   ```sql
   CREATE ROLE enertrack LOGIN PASSWORD 'replace-with-a-strong-password';
   CREATE DATABASE enertrack OWNER enertrack;
   ```

2. Copy `.env.example` to `.env`. Set `DATABASE_URL` to the database credentials and
   set `SESSION_SECRET` to a unique random value of at least 32 characters. Keep `.env`
   private; it is excluded from Git.
3. Install dependencies and create/update the schema:

   ```powershell
   npm install
   npm run db:migrate
   ```

4. Start the server and open the local site:

   ```powershell
   npm start
   ```

   `npm start` also runs the tracked database migrations automatically before the server
   starts. If a migration fails, the server will not start, and the migration error is
   printed to the deployment logs.

   Browse to `http://localhost:3000`. The first and only registered account can claim
   administrator access once; complete this setup before registering other users. New
   registrations are active auditor accounts and can sign in immediately. An administrator
   must approve any change to administrator access. Audit submissions have a separate
   administrator review queue and are excluded from university totals until approved.

Existing users can sign in with their email address or registration number. Configure
the SMTP settings in `.env` to enable password-reset email; without SMTP, the reset
request endpoint returns a configuration error and cannot send email.

Run the application checks with `npm test`. During local development, `npm run dev`
restarts the server when backend files change.

## Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string; required |
| `SESSION_SECRET` | Secret used to sign server-side session cookies; required |
| `PORT` | HTTP port (defaults to `3000`) |
| `NODE_ENV` | Set to `production` when deployed |
| `DATABASE_SSL` | Set to `true` when the database host requires verified TLS |
| `TRUST_PROXY` | Set to `true` only when deployed behind a trusted reverse proxy |
| `FRONTEND_ORIGINS` | Comma-separated exact browser origins allowed to call the API |
| `SESSION_SAME_SITE` | Session cookie setting; defaults to `lax` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | SMTP settings for password reset |
| `PUBLIC_APP_URL` | Public site URL used to construct password-reset links |
| `MAX_JSON_BODY` | Maximum JSON request size (defaults to `16mb`, including resized photos) |

Keep the frontend and API on the same origin when possible. A GitHub Pages site and an
API hosted on another domain may encounter browser restrictions on cross-site session
cookies even when CORS is configured. For production, use a custom domain and reverse
proxy, or another same-site hosting arrangement. Configure only trusted exact origins;
do not use wildcard credentialed CORS. If deploying the static site separately, set
`window.ENERTRACK_API_BASE_URL` in `api-config.js` to the API origin and set that exact
frontend origin in the API's `FRONTEND_ORIGINS`.

Audit photos are currently stored as PostgreSQL `bytea` values with a per-image 2 MB
limit. For larger deployments, move binary assets to private object storage and retain
only metadata and storage keys in PostgreSQL. Database backups must include uploaded
photos and audit records.

## API overview

- `GET /api/health`, `GET /api/auth/me`
- `POST /api/auth/register`, `/login`, `/logout`, `/claim-admin`
- `POST /api/auth/password-reset/request`, `/password-reset/complete`
- `GET /api/facilities`, `GET|POST /api/audits`, `GET|PUT|DELETE /api/audits/:id`
- `GET /api/dashboard` (approved university totals and the signed-in user's audits, bill totals, and PDF links)
- `POST /api/audits/:id/submit`, `GET /api/audits/:id/photos/:photoId`
- `GET /api/dashboard`, `GET|PUT /api/recommendations`
- `GET /api/admin/audits`, `PATCH /api/admin/audits/:id/review`
- `GET /api/admin/users`, `PATCH /api/admin/users/:id/role`
- `GET /api/audits/:id/report.pdf`

Audit records include facility details, equipment, monthly utility readings, auditor-entered
findings, recommendations, and supporting photos. The migration runner applies incremental
schema updates when the server's database is provisioned.

The database migration seeds the nine existing facility names. Audit calculations are
derived from validated equipment and tariff inputs on the server for university totals.
After sign-in, the frontend imports existing browser-local audit records into PostgreSQL.
It removes the local audit copy only after the server saves the imported records
successfully. Local passwords and account roles are not imported.

## GitHub Pages

GitHub Pages can continue to serve a static frontend but cannot run this Express server
or PostgreSQL. Deploy the API and database separately, set the exact frontend origin in
`FRONTEND_ORIGINS`, and configure HTTPS, session-cookie settings, database TLS, SMTP,
and private persistent file storage for the chosen hosting provider.
