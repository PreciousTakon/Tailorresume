# Resume Tailor

Searches job boards for postings from the last 24 hours (or 48h / 7 days), then tailors your resume to each one with Claude.

## Run
1. Install Node 18+.
2. `export ANTHROPIC_API_KEY=sk-ant-...` (Windows PowerShell: `$env:ANTHROPIC_API_KEY="sk-ant-..."`)
3. `node server.js`, then open http://localhost:3000

No `npm install` needed.

## Adding jobs by link
Paste a job URL under "Add a job from a link or text". The server reads the page (using the structured job data most boards embed, or the page text). LinkedIn, Indeed and some others block automated access or need a login; for those, use the "paste the job text instead" box. Links to internal or private addresses are blocked.

## Job sources (US-focused)
- **Adzuna** (recommended, free key at developer.adzuna.com): best US local coverage, supports city/state search. Set `ADZUNA_APP_ID` and `ADZUNA_APP_KEY`. Returns only a description snippet, so tailoring is less precise for these.
- **USAJobs** (optional, free key at developer.usajobs.gov): federal jobs. Set `USAJOBS_KEY` and `USAJOBS_EMAIL`.
- **The Muse**, **Remotive**, **Jobicy**: no key needed. US-based and US-eligible remote roles, full descriptions.

LinkedIn and Indeed have no open APIs, so they aren't included. Add sources as functions in the `sources` object in server.js.

## Hosting free on Render
1. Push this folder to a GitHub repo.
2. Render: New > Web Service > pick the repo. Runtime Node, build command blank, start command `node server.js`, instance type Free.
3. Environment variables: `ANTHROPIC_API_KEY`, `APP_PASSWORD` (required when hosted; the browser asks for it, username can be anything), and optionally `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `USAJOBS_KEY`, `USAJOBS_EMAIL`.
4. Free instances sleep after 15 minutes idle; the first visit after that takes about a minute.

Set `APP_PASSWORD` locally too if you want a password there.

## Notes
- Tailoring never invents experience; it lists requirements your resume doesn't cover.
- Review every resume before sending.
- `CLAUDE_MODEL` env var overrides the model (default claude-sonnet-5-5).
