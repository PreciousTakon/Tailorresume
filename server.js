// Resume Tailor: zero-dependency server (Node 18+). Run: ANTHROPIC_API_KEY=... node server.js
const http = require("http"), fs = require("fs"), path = require("path");
const PORT = process.env.PORT || 3000;
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const clean = v => (v || "").trim().replace(/^["']|["']$/g, "");
const ADZUNA_APP_ID = clean(process.env.ADZUNA_APP_ID), ADZUNA_APP_KEY = clean(process.env.ADZUNA_APP_KEY), APP_PASSWORD = process.env.APP_PASSWORD;
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
  if (!r.ok) { const t = (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160); throw new Error(url.split("?")[0] + " -> " + r.status + (t ? " " + t : "")); }
  return r.json(); };

// Each source returns [{id,title,company,location,url,posted(ms),description,source}]
const US_OK = /usa|u\.s\.|united states|america|worldwide|anywhere|north america/i;
const words = q => q.toLowerCase().split(/\s+/).filter(Boolean);
const sources = {
  // Best US coverage: free key at developer.adzuna.com (ADZUNA_APP_ID / ADZUNA_APP_KEY)
  async adzuna(q, where, hours, titleOnly) {
    if (!ADZUNA_APP_ID) return [];
    const u = `https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}` +
      `&results_per_page=50&sort_by=date&max_days_old=${Math.max(1, Math.ceil(hours / 24))}&${titleOnly ? "title_only" : "what"}=${encodeURIComponent(q)}&where=${encodeURIComponent(where || "")}`;
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
    const pages = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(p => getJSON("https://www.themuse.com/api/public/jobs?descending=true&page=" + p)));
    const w = words(q);
    return pages.flatMap(p => p.results).filter(j => w.some(x => j.name.toLowerCase().includes(x)) || w.every(x => (j.name + " " + j.contents).toLowerCase().includes(x)))
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

async function search(q, where, hours, titleOnly) {
  if (/^(us|usa|u\.s\.a?\.?|united states( of america)?|america|anywhere|nationwide)$/i.test((where || "").trim())) where = ""; // whole US
  const cutoff = Date.now() - hours * 3600e3, warnings = [], stats = [];
  const runs = await Promise.all(Object.entries(sources).map(async ([n, f]) => {
    try {
      const r = await f(q, where, hours, titleOnly);
      stats.push({ source: n, found: r.length, recent: r.filter(j => j.posted >= cutoff).length });
      return r;
    } catch (e) { warnings.push(n + ": " + e.message); return []; }
  }));
  let jobs = runs.flat().filter(j => j.posted >= cutoff);
  if (titleOnly) { const w = words(q); jobs = jobs.filter(j => w.some(x => j.title.toLowerCase().includes(x))); }
  if (where) { // Adzuna and USAJobs already filtered by location on their side
    const w = where.toLowerCase(), city = w.split(",")[0].trim();
    jobs = jobs.filter(j => ["Adzuna", "USAJobs"].includes(j.source) || j.location.toLowerCase().includes(city) || /remote|anywhere|worldwide/i.test(j.location));
  }
  const seen = new Set();
  jobs = jobs.filter(j => { const k = (j.title + j.company).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  return { jobs: jobs.sort((a, b) => b.posted - a.posted), warnings, stats, adzuna: !!ADZUNA_APP_ID };
}

// ---- Fetch a job from a pasted link (blocks private/internal addresses) ----
const dns = require("dns").promises;
const isPrivate = ip => /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) || /^(::1|::|f[cd][0-9a-f]{2}:|fe80:)/i.test(ip) || /^::ffff:/i.test(ip);
async function fetchPage(link, accept = "text/html,application/xhtml+xml") {
  for (let hop = 0; hop < 5; hop++) {
    const x = new URL(link);
    if (!/^https?:$/.test(x.protocol)) throw new Error("Only http(s) links are supported");
    const { address } = await dns.lookup(x.hostname);
    if (isPrivate(address)) throw new Error("That address isn't allowed");
    const r = await fetch(x, { redirect: "manual", signal: AbortSignal.timeout(12000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; resume-tailor/1.0)", Accept: accept } });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { link = new URL(r.headers.get("location"), x).href; continue; }
    if (!r.ok) throw new Error("The site returned " + r.status + " (many job sites block automated access)");
    return { html: (await r.text()).slice(0, 2e6), url: x.href };
  }
  throw new Error("Too many redirects");
}
const findPosting = n => Array.isArray(n) ? n.map(findPosting).find(Boolean) : n && typeof n === "object"
  ? ([].concat(n["@type"] || []).includes("JobPosting") ? n : findPosting(n["@graph"] || Object.values(n))) : null;
// Workday pages load via JavaScript; every posting also has a JSON twin under /wday/cxs/
function workdayApiUrl(link) {
  const u = new URL(link);
  if (!/\.(myworkdayjobs|myworkdaysite)\.com$/i.test(u.hostname)) return null;
  const seg = u.pathname.split("/").filter(Boolean).filter(x => !/^[a-z]{2}(-[A-Za-z]{2})?$/.test(x));
  const i = seg.indexOf("job"); if (i < 1) return null;
  const rest = seg.slice(i).filter(x => !/^(apply|applyManually|autofillWithResume)$/i.test(x));
  const tenant = u.hostname.split(".")[0];
  return `https://${u.hostname}/wday/cxs/${tenant}/${seg[i - 1]}/${rest.join("/")}`;
}
async function workdayJob(link) {
  let api; try { api = workdayApiUrl(link); } catch (e) { return null; }
  if (!api) return null;
  try {
    const { html } = await fetchPage(api, "application/json");
    const d = JSON.parse(html), p = d.jobPostingInfo; if (!p) return null;
    return { id: "lnk" + Date.now(), title: strip(p.title || "Job"), company: strip(d.hiringOrganization?.name || new URL(link).hostname.split(".")[0]),
      location: [p.location, p.country?.descriptor].filter(Boolean).join(", ") || "See posting", url: link, source: "Link",
      posted: Date.parse(p.startDate) || Date.now(), description: strip(p.jobDescription || "") };
  } catch (e) { return null; }
}
async function bambooJob(link) {
  const m = link.match(/^https?:\/\/([a-z0-9-]+)\.bamboohr\.com\/(?:careers|jobs)\/(\d+)/i);
  if (!m) return null;
  try { // BambooHR pages load via JavaScript; their JSON endpoint has the full posting
    const { html, url } = await fetchPage(`https://${m[1]}.bamboohr.com/careers/${m[2]}/detail`, "application/json");
    const o = JSON.parse(html), p = o.result?.jobOpening || o.result || o;
    if (!p.jobOpeningName && !p.description) return null;
    const loc = p.location ? [p.location.city, p.location.state].filter(Boolean).join(", ") : "";
    return { id: "lnk" + Date.now(), title: strip(p.jobOpeningName || "Job"), company: strip(p.companyName || m[1].replace(/-/g, " ")), url: link, source: "Link",
      location: loc || (p.isRemote ? "Remote" : p.atsLocation?.country || "See posting"), posted: Date.parse(p.datePosted) || Date.now(), description: strip(p.description || "") };
  } catch (e) { return null; }
}
async function jobFromLink(link) {
  const bb = (await bambooJob(link)) || (await workdayJob(link)); if (bb) return bb;
  // iCIMS shows the posting inside an iframe; ?in_iframe=1 returns that content directly
  let target = link;
  try { const t = new URL(link); if (/\.icims\.com$/i.test(t.hostname) && !t.searchParams.has("in_iframe")) { t.searchParams.set("in_iframe", "1"); target = t.href; } } catch (e) {}
  const page = await fetchPage(target);
  const html = page.html, url = page.url.replace(/([?&])in_iframe=1&?/, "$1").replace(/[?&]$/, "");
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

const PROMPT = (r, j, extra) => `You are an expert resume writer. Tailor the candidate's resume to the job below.

STRICT RULES (follow every one)
1. TRUTH ONLY. Use only facts that appear in the base resume or in the ADDITIONAL FACTS section (if present). Never add a title, seniority level (do not call the candidate a "Leader" or "Manager" unless a held title says so), tool, skill, practice, metric, employer type, stakeholder group, compliance framework or certification that is not written in the base resume or ADDITIONAL FACTS. If a job keyword has no equivalent fact in the resume, leave it out (it goes in the NOTES instead).
2. KEEP FIXED FACTS EXACTLY: name, contact line, headline line, employers, job titles, locations, dates, certifications, degrees and schools.
3. KEEP EVERYTHING SUBSTANTIVE. Keep every tool, technology, skill and metric from the base resume. In the skills section you may regroup and reorder lines so the job's most relevant skills come first, but never delete a skill, tool or category. Keep every experience bullet; you may reword lightly to mirror the job's terminology, reorder bullets so the most relevant come first, or merge two near-duplicate bullets without losing any tool or number.
4. SUMMARY: 3-4 sentences, true to the candidate's real title and years of experience, emphasizing the experience most relevant to this job.
5. FORMAT, plain text only (no markdown, no ** or #): line 1 = name; line 2 = headline line (if the base resume has one); next line = contact line; then section headings in ALL CAPS on their own line (PROFESSIONAL SUMMARY, CORE TECHNICAL EXPERTISE, PROFESSIONAL EXPERIENCE, CERTIFICATIONS, EDUCATION). In experience: a company line like "COMPANY NAME — City, ST", then a role line like "Job Title | Mon YYYY – Mon YYYY", then bullets starting with "- ". Skills as bullets like "- Cloud: AWS, Azure". Certifications and education as bullets.

Reply in exactly this format:
<resume text>
===NOTES===
<3-5 short lines: keywords matched, what you emphasized, and job requirements the resume does NOT cover (including any requirement such as citizenship, clearance, certifications or years of management experience)>

BASE RESUME:
${r}
${extra ? `
ADDITIONAL FACTS FROM THE CANDIDATE (true, but not on the base resume). Use an item ONLY if it is relevant to this job. Add it to the skills section and, only if the candidate gave enough detail, to the most fitting experience bullet. Never invent employers, dates, depth of experience or metrics beyond what is written here:
${extra}
` : ""}

JOB: ${j.title} at ${j.company}
${j.description.slice(0, 12000)}`;

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODELS = [process.env.GEMINI_MODEL, "gemini-2.5-flash", "gemini-3.5-flash", "gemini-3-flash-preview"].filter(Boolean);

async function askGemini(prompt) {
  let last = "";
  for (const m of GEMINI_MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 6000, temperature: 0.4 } }) });
    const d = await r.json().catch(() => ({}));
    if (r.status === 404) { last = `Model ${m} not found`; continue; } // try the next model name
    if (r.status === 429) throw new Error("Gemini free-tier limit reached. Wait a minute or try again tomorrow.");
    if (!r.ok) throw new Error(d.error?.message || "Gemini API error " + r.status);
    const text = (d.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
    if (!text) throw new Error("Gemini returned no text (" + (d.candidates?.[0]?.finishReason || d.promptFeedback?.blockReason || "unknown") + ")");
    return text;
  }
  throw new Error(last + ". Set GEMINI_MODEL to a current model id.");
}

async function askClaude(prompt) {
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: "user", content: prompt }] }) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error?.message || "Claude API error " + r.status);
  return d.content.map(c => c.text || "").join("");
}

// Uses Gemini (free tier) if GEMINI_API_KEY is set, otherwise Claude if ANTHROPIC_API_KEY is set.
async function tailor(resume, job, extra) {
  if (!GEMINI_KEY && !KEY) throw new Error("No AI key set. Add GEMINI_API_KEY (free) or ANTHROPIC_API_KEY.");
  const text = await (GEMINI_KEY ? askGemini : askClaude)(PROMPT(resume, job, extra));
  const [out, notes = ""] = text.split("===NOTES===");
  return { resume: out.trim(), notes: notes.trim() };
}

const body = req => new Promise((ok, no) => { let b = ""; req.on("data", c => { b += c; if (b.length > 2e6) req.destroy(); }); req.on("end", () => ok(b)); req.on("error", no); });
const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (!authed(req)) { res.writeHead(401, { "www-authenticate": 'Basic realm="Resume Tailor"' }); return res.end("Password required"); }
  try {
    if (u.pathname === "/api/jobs") return send(res, 200, await search(u.searchParams.get("q") || "", u.searchParams.get("where") || "", +u.searchParams.get("hours") || 24, u.searchParams.get("title") === "1"));
    if (u.pathname === "/api/fetchjob") return send(res, 200, { job: await jobFromLink(u.searchParams.get("url") || "") });
    if (u.pathname === "/api/tailor" && req.method === "POST") { const { resume, job, extra } = JSON.parse(await body(req)); return send(res, 200, await tailor(resume, job, (extra || "").slice(0, 3000))); }
    res.writeHead(200, { "content-type": "text/html" }); res.end(fs.readFileSync(path.join(__dirname, "index.html")));
  } catch (e) { send(res, 500, { error: e.message }); }
}).listen(PORT, () => console.log("Resume Tailor running at http://localhost:" + PORT + (KEY || GEMINI_KEY ? "" : "  (set GEMINI_API_KEY or ANTHROPIC_API_KEY to enable tailoring)")));
