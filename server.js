// Resume Tailor: zero-dependency server (Node 18+). Run: ANTHROPIC_API_KEY=... node server.js
const http = require("http"), fs = require("fs"), path = require("path");
const PORT = process.env.PORT || 3000;
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const { ADZUNA_APP_ID, ADZUNA_APP_KEY, APP_PASSWORD } = process.env;
const crypto = require("crypto");
if (!APP_PASSWORD && process.env.RENDER) { console.error("Set APP_PASSWORD before hosting publicly."); process.exit(1); }
const authed = req => {
  if (!APP_PASSWORD) return true; // local use without a password
  const pw = Buffer.from((req.headers.authorization || "").replace(/^Basic /, ""), "base64").toString().split(":").slice(1).join(":");
  const a = crypto.createHash("sha256").update(pw).digest(), b = crypto.createHash("sha256").update(APP_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
};

const strip = h => (h || "").replace(/<(br|\/p|\/li|\/h\d)\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#39;|&rsquo;/g, "'").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
const getJSON = async (url) => { const r = await fetch(url, { headers: { "User-Agent": "resume-tailor/1.0" } });
  if (!r.ok) throw new Error(url.split("?")[0] + " -> " + r.status); return r.json(); };

// Each source returns [{id,title,company,location,url,posted(ms),description,source}]
const US_OK = /usa|u\.s\.|united states|america|worldwide|anywhere|north america/i;
const words = q => q.toLowerCase().split(/\s+/).filter(Boolean);
const sources = {
  // Best US coverage: free key at developer.adzuna.com (ADZUNA_APP_ID / ADZUNA_APP_KEY)
  async adzuna(q, where, hours) {
    if (!ADZUNA_APP_ID) return [];
    const u = `https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}` +
      `&results_per_page=50&sort_by=date&max_days_old=${Math.max(1, Math.ceil(hours / 24))}&what=${encodeURIComponent(q)}&where=${encodeURIComponent(where || "")}`;
    const d = await getJSON(u);
    return d.results.map(j => ({ id: "adz" + j.id, title: j.title.replace(/<[^>]+>/g, ""), company: j.company?.display_name || "",
      location: j.location?.display_name || "", url: j.redirect_url, posted: Date.parse(j.created), source: "Adzuna",
      description: strip(j.description) + "\n\n(Snippet only; open the link for the full posting.)" }));
  },
  // US federal jobs: free key at developer.usajobs.gov (USAJOBS_KEY + USAJOBS_EMAIL)
  async usajobs(q, where, hours) {
    if (!process.env.USAJOBS_KEY) return [];
    const u = `https://data.usajobs.gov/api/search?ResultsPerPage=50&SortField=opendate&SortDirection=desc&DatePosted=${Math.max(1, Math.ceil(hours / 24))}` +
      `&Keyword=${encodeURIComponent(q)}&LocationName=${encodeURIComponent(where || "")}`;
    const r = await fetch(u, { headers: { "User-Agent": process.env.USAJOBS_EMAIL || "", "Authorization-Key": process.env.USAJOBS_KEY } });
    if (!r.ok) throw new Error("usajobs -> " + r.status);
    return (await r.json()).SearchResult.SearchResultItems.map(({ MatchedObjectDescriptor: m }) => ({ id: "usa" + m.PositionID, title: m.PositionTitle,
      company: m.OrganizationName, location: m.PositionLocationDisplay, url: m.PositionURI, posted: Date.parse(m.PublicationStartDate), source: "USAJobs",
      description: strip(m.UserArea?.Details?.JobSummary || m.QualificationSummary || "") }));
  },
  // The Muse: no key, US-focused; newest first, filtered by keywords here
  async muse(q) {
    const pages = await Promise.all([0, 1, 2, 3, 4].map(p => getJSON("https://www.themuse.com/api/public/jobs?descending=true&page=" + p)));
    const w = words(q);
    return pages.flatMap(p => p.results).filter(j => w.every(x => (j.name + " " + j.contents).toLowerCase().includes(x)))
      .map(j => ({ id: "mus" + j.id, title: j.name, company: j.company?.name || "", location: (j.locations || []).map(l => l.name).join("; ") || "Not listed",
        url: j.refs?.landing_page, posted: Date.parse(j.publication_date), description: strip(j.contents), source: "The Muse" }));
  },
  // Remote jobs open to US candidates (no key)
  async remotive(q) {
    const d = await getJSON("https://remotive.com/api/remote-jobs?limit=100&search=" + encodeURIComponent(q));
    return d.jobs.filter(j => US_OK.test(j.candidate_required_location || "worldwide")).map(j => ({ id: "rem" + j.id, title: j.title, company: j.company_name,
      location: "Remote (" + (j.candidate_required_location || "Worldwide") + ")", url: j.url, posted: Date.parse(j.publication_date + "Z"), description: strip(j.description), source: "Remotive" }));
  },
  async jobicy(q) {
    const d = await getJSON("https://jobicy.com/api/v2/remote-jobs?count=50&geo=usa&tag=" + encodeURIComponent(q));
    return (d.jobs || []).map(j => ({ id: "job" + j.id, title: j.jobTitle, company: j.companyName, location: "Remote (" + (j.jobGeo || "USA") + ")",
      url: j.url, posted: Date.parse(String(j.pubDate).replace(" ", "T") + "Z"), description: strip(j.jobDescription), source: "Jobicy" }));
  },
};

async function search(q, where, hours) {
  const cutoff = Date.now() - hours * 3600e3, warnings = [];
  const runs = await Promise.allSettled(Object.entries(sources).map(([n, f]) => f(q, where, hours).catch(e => { warnings.push(n + ": " + e.message); return []; })));
  let jobs = runs.flatMap(r => r.value || []).filter(j => j.posted >= cutoff);
  if (where) { const w = where.toLowerCase(); jobs = jobs.filter(j => j.location.toLowerCase().includes(w) || /remote|anywhere|worldwide/i.test(j.location)); }
  const seen = new Set();
  jobs = jobs.filter(j => { const k = (j.title + j.company).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  return { jobs: jobs.sort((a, b) => b.posted - a.posted), warnings };
}


// ---- Fetch a job from a pasted link (blocks private/internal addresses) ----
const dns = require("dns").promises;
const isPrivate = ip => /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) || /^(::1|::|f[cd][0-9a-f]{2}:|fe80:)/i.test(ip) || /^::ffff:/i.test(ip);
async function fetchPage(link) {
  for (let hop = 0; hop < 5; hop++) {
    const x = new URL(link);
    if (!/^https?:$/.test(x.protocol)) throw new Error("Only http(s) links are supported");
    const { address } = await dns.lookup(x.hostname);
    if (isPrivate(address)) throw new Error("That address isn't allowed");
    const r = await fetch(x, { redirect: "manual", signal: AbortSignal.timeout(12000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; resume-tailor/1.0)", Accept: "text/html,application/xhtml+xml" } });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { link = new URL(r.headers.get("location"), x).href; continue; }
    if (!r.ok) throw new Error("The site returned " + r.status + " (many job sites block automated access)");
    return { html: (await r.text()).slice(0, 2e6), url: x.href };
  }
  throw new Error("Too many redirects");
}
const findPosting = n => Array.isArray(n) ? n.map(findPosting).find(Boolean) : n && typeof n === "object"
  ? ([].concat(n["@type"] || []).includes("JobPosting") ? n : findPosting(n["@graph"] || Object.values(n))) : null;
async function jobFromLink(link) {
  const { html, url } = await fetchPage(link);
  let p = null;
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { p = findPosting(JSON.parse(m[1])); if (p) break; } catch (e) {}
  }
  const meta = re => (html.match(re) || [])[1];
  if (p) {
    const loc = [].concat(p.jobLocation || []).map(l => [l.address?.addressLocality, l.address?.addressRegion].filter(Boolean).join(", ")).filter(Boolean).join("; ");
    return { id: "lnk" + Date.now(), title: strip(p.title || ""), company: strip(p.hiringOrganization?.name || new URL(url).hostname), url, source: "Link",
      location: loc || (p.jobLocationType === "TELECOMMUTE" ? "Remote" : "Not listed"), posted: Date.parse(p.datePosted) || Date.now(), description: strip(p.description || "") };
  }
  const text = strip(html.replace(/<(script|style|noscript|nav|header|footer|svg)[\s\S]*?<\/\1>/gi, " "));
  if (text.length < 300) throw new Error("Couldn't read a job description from that page (it may need JavaScript or a login). Paste the text instead.");
  return { id: "lnk" + Date.now(), title: strip(meta(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i) || meta(/<title[^>]*>([^<]*)/i) || "Job from link"),
    company: new URL(url).hostname.replace(/^www\./, ""), location: "See posting", url, source: "Link", posted: Date.now(), description: text.slice(0, 15000) };
}

const PROMPT = (r, j) => `You are an expert resume writer. Tailor the candidate's resume to the job below.

STRICT RULES
- Use ONLY facts present in the base resume. Never invent employers, titles, dates, degrees, skills, metrics or certifications.
- Reorder sections and bullets so the most relevant experience comes first; reword bullets to mirror the job's terminology where truthful; add a short targeted summary.
- Plain text only: first line is the candidate's name, then a contact line, then section headings in ALL CAPS, bullets starting with "- ".

Reply in exactly this format:
<resume text>
===NOTES===
<3-5 short lines: keywords matched, what you emphasized, and job requirements the resume does NOT cover>

BASE RESUME:
${r}

JOB: ${j.title} at ${j.company}
${j.description.slice(0, 12000)}`;

async function tailor(resume, job) {
  if (!KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: "user", content: PROMPT(resume, job) }] }) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error?.message || "Claude API error " + r.status);
  const [out, notes = ""] = d.content.map(c => c.text || "").join("").split("===NOTES===");
  return { resume: out.trim(), notes: notes.trim() };
}

const body = req => new Promise((ok, no) => { let b = ""; req.on("data", c => { b += c; if (b.length > 2e6) req.destroy(); }); req.on("end", () => ok(b)); req.on("error", no); });
const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (!authed(req)) { res.writeHead(401, { "www-authenticate": 'Basic realm="Resume Tailor"' }); return res.end("Password required"); }
  try {
    if (u.pathname === "/api/jobs") return send(res, 200, await search(u.searchParams.get("q") || "", u.searchParams.get("where") || "", +u.searchParams.get("hours") || 24));
    if (u.pathname === "/api/fetchjob") return send(res, 200, { job: await jobFromLink(u.searchParams.get("url") || "") });
    if (u.pathname === "/api/tailor" && req.method === "POST") { const { resume, job } = JSON.parse(await body(req)); return send(res, 200, await tailor(resume, job)); }
    res.writeHead(200, { "content-type": "text/html" }); res.end(fs.readFileSync(path.join(__dirname, "index.html")));
  } catch (e) { send(res, 500, { error: e.message }); }
}).listen(PORT, () => console.log("Resume Tailor running at http://localhost:" + PORT + (KEY ? "" : "  (set ANTHROPIC_API_KEY to enable tailoring)")));
