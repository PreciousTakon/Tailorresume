# Resume Tailor

Searches job boards for postings from the last 24 hours (or 48h / 7 days), then tailors your resume to each one with Claude.

## Features
- Search US jobs (Adzuna, USAJobs, The Muse, Remotive, Jobicy) from the last 24h / 48h / 7 days.
- Add a job by link (works with most boards, BambooHR, Workday, iCIMS) or by pasting the text.
- Tailors your resume to each job without inventing experience; lists requirements you don't meet.
- Separate saved profiles per client (resume + extra skills + email), saved on the server so they follow you to every device. "Clear all saved data" removes them everywhere.
- Optional box for true skills that aren't on your resume.
- Filter by Remote / Hybrid / On-site (work type is guessed from the posting text).
- One-click cover letters per job (truthful, from your resume), downloadable as PDF, .docx or .txt.
- Saved applications per client: keep each tailored resume and cover letter with its job link, a status (Saved, Applied, Interview, Offer, Rejected, Withdrawn), applied date and notes. Reopen, edit and download them any time; jobs you already saved or applied for are flagged in new searches. Stored with the client, so they sync across devices (about 900 KB total).
- Export applications as CSV (this client or all clients; opens in Excel or Google Sheets), or send them to a Google Sheet in your Drive (needs the Google setup below).
- Download resumes as PDF, .docx or .txt.

## Run
1. Install Node 18+.
2. Set one AI key:
   - Free: `GEMINI_API_KEY` from aistudio.google.com (Get API key). If set, Gemini is used.
   - Or paid: `ANTHROPIC_API_KEY` from console.anthropic.com (used when no Gemini key is set).
   Example: `export GEMINI_API_KEY=...` (Windows PowerShell: `$env:GEMINI_API_KEY="..."`)
3. `node server.js`, then open http://localhost:3000

No `npm install` needed.

## Adding jobs by link
Paste a job URL under "Add a job from a link or text". The server reads the page (using the structured job data most boards embed, or the page text). LinkedIn, Indeed and some others block automated access or need a login; for those, use the "paste the job text instead" box. Links to internal or private addresses are blocked.

## More sources (optional)
- **Company career boards:** in the app, open "company career boards to watch" and list companies (`greenhouse:stripe`, `lever:palantir`, `ashby:ramp`, or paste a careers-page link). Full descriptions, real posting dates, no key. You can also set the `COMPANIES` env var (comma-separated) as a default.
- **Jooble:** free key at jooble.org/api/about (US jobs), set `JOOBLE_API_KEY`. The free key has a lifetime limit of 500 requests (the app uses 1 per search), so leave it unset unless you need it. Links go through jooble.org.
- **Himalayas:** remote jobs, no key. Attribution required: the app links each job back to himalayas.app.

## Job sources (US-focused)
- **Adzuna** (recommended, free key at developer.adzuna.com): best US local coverage, supports city/state search. Set `ADZUNA_APP_ID` and `ADZUNA_APP_KEY`. Returns only a description snippet, so tailoring is less precise for these.
- **USAJobs** (optional, free key at developer.usajobs.gov): federal jobs. Set `USAJOBS_KEY` and `USAJOBS_EMAIL`.
- **The Muse**, **Remotive**, **Jobicy**: no key needed. US-based and US-eligible remote roles, full descriptions.

LinkedIn and Indeed have no open APIs, so they aren't included. Add sources as functions in the `sources` object in server.js.

## Hosting free on Render
1. Push this folder to a GitHub repo.
2. Render: New > Web Service > pick the repo. Runtime Node, build command blank, start command `node server.js`, instance type Free.
3. Environment variables: `GEMINI_API_KEY` (free) or `ANTHROPIC_API_KEY`, `APP_PASSWORD` (required when hosted; the browser asks for it, username can be anything), and optionally `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `USAJOBS_KEY`, `USAJOBS_EMAIL`.
4. Free instances sleep after 15 minutes idle; the first visit after that takes about a minute.

Set `APP_PASSWORD` locally too if you want a password there.

## Saved clients on every device
Clients, resumes, extra skills, client emails and your company watch list are saved on the server, behind your `APP_PASSWORD`. Open the site on any device, enter the password, and everything is there. Changes autosave a moment after you stop typing, and a device that was idle picks up changes made elsewhere. If two devices edit at once, the app asks which copy to keep.

Render's free plan wipes the server's disk on every restart and redeploy, so give it a permanent place to save:
- **Free (recommended):** create a free Redis database at upstash.com, copy its REST URL and REST token, and set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in Render. Data limit is about 900 KB (dozens of clients).
- **Own computer / paid Render disk / VPS:** the app writes `data/data.json` (set `DATA_DIR` to a persistent folder).
Until one of these is set on Render, the app shows a warning that storage is temporary.

Everyone who knows the password shares the same saved clients. Keep the Upstash token secret, since it can read every saved resume.

## Save to Google Drive button (optional)
Set `GOOGLE_CLIENT_ID` to add a "Save to Google Drive" button under each resume and cover letter. It uploads the PDF to a folder "Resume Tailor - <client name>" in the signed-in user's Drive, shared view-only with the client's email if you entered one. Sign-in happens in the browser; no Google tokens reach the server.
Setup: in Google Cloud console create a project, enable the Google Drive API, configure the OAuth consent screen (External; while in Testing, add each user's Google account as a test user), and create an OAuth client ID (Web application) with your site (https://your-app.onrender.com, and http://localhost:3000 for local use) under Authorized JavaScript origins. Scope requested: drive.file (the app can see only files it created).

## Notes
- Tailoring never invents experience; it lists requirements your resume doesn't cover.
- Review every resume before sending.
- `GEMINI_MODEL` overrides the Gemini model (default gemini-2.5-flash, with fallbacks); `CLAUDE_MODEL` overrides the Claude model.
- Free-tier providers may use your inputs to improve their products; check their terms before uploading a resume with sensitive details.
