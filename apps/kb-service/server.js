const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 4010);
const ROOT_DIR = path.resolve(__dirname, "../..");
const EXPORTS_DIR = path.join(ROOT_DIR, "exports");
const CUSTOMER_CHAT_HTML_PATH = path.join(__dirname, "public/customer-chat.html");
const STAFF_UI_HTML_PATH = path.join(__dirname, "public/staff.html");

const DEFAULT_K = 10;
const MAX_K = 50;
const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_ANSWER_CITATIONS = 3;
const MAX_ANSWER_CITATIONS = 5;
const SEARCH_LIVE_RELEVANCE_THRESHOLD = 2;
const ANSWER_LIVE_RELEVANCE_THRESHOLD = 4;
const KB_DEBUG = process.env.KB_DEBUG === "1";
const CUSTOMER_RATE_LIMIT_MAX = Number(process.env.KB_CUSTOMER_RATE_LIMIT_MAX || 60);
const CUSTOMER_RATE_LIMIT_WINDOW_MS = Number(
  process.env.KB_CUSTOMER_RATE_LIMIT_WINDOW_MS || 60_000
);

const customerRateLimitByIp = new Map();

function makeRequestId() {
  return `req_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function sendJson(res, statusCode, payload, requestId) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "x-request-id": requestId,
  });
  res.end(body);
}

function sendHtml(res, statusCode, html, requestId) {
  res.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
    "x-request-id": requestId,
  });
  res.end(html);
}

function sendError(res, statusCode, code, message, requestId, details) {
  const payload = { code, message, requestId };
  if (details !== undefined) {
    payload.details = details;
  }
  sendJson(res, statusCode, payload, requestId);
}

function resolveScopeFromAuth(req) {
  const authHeader = req.headers.authorization;
  if (typeof authHeader !== "string") {
    return "customer";
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return "customer";
  }

  const token = match[1].trim();
  return token ? "internal" : "customer";
}

function isPolicyAllowedForScope(scope, source, visibility, allowDraftFallback = false) {
  if (scope === "customer") {
    return source === "live" && visibility === "public";
  }

  if (scope === "internal") {
    if (source === "live") {
      return true;
    }
    if (source === "draft") {
      return allowDraftFallback;
    }
  }

  return false;
}

function logInternalDebug(scope, message, payload) {
  if (!KB_DEBUG || scope !== "internal") {
    return;
  }
  console.log(`[KB_DEBUG] ${message}`, payload);
}

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  const remote = req.socket?.remoteAddress || "unknown";
  return remote.startsWith("::ffff:") ? remote.slice(7) : remote;
}

function checkCustomerRateLimit(req, scope) {
  if (scope !== "customer") {
    return { allowed: true };
  }

  if (!Number.isFinite(CUSTOMER_RATE_LIMIT_MAX) || CUSTOMER_RATE_LIMIT_MAX <= 0) {
    return { allowed: true };
  }

  const now = Date.now();
  const ip = getClientIp(req);
  const existing = customerRateLimitByIp.get(ip) || [];
  const windowed = existing.filter((timestamp) => now - timestamp < CUSTOMER_RATE_LIMIT_WINDOW_MS);

  if (windowed.length >= CUSTOMER_RATE_LIMIT_MAX) {
    customerRateLimitByIp.set(ip, windowed);
    const retryAfterMs = Math.max(
      0,
      CUSTOMER_RATE_LIMIT_WINDOW_MS - (now - windowed[0])
    );
    return {
      allowed: false,
      ip,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    };
  }

  windowed.push(now);
  customerRateLimitByIp.set(ip, windowed);
  return { allowed: true };
}

function normalizeString(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

async function readJsonFile(fileName) {
  const filePath = path.join(EXPORTS_DIR, fileName);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function loadExportData() {
  const [liveIndex, livePoliciesPayload, draftPoliciesPayload] = await Promise.all([
    readJsonFile("index.json"),
    readJsonFile("policies.json"),
    readJsonFile("policies-draft.json"),
  ]);

  const liveIndexPolicies = Array.isArray(liveIndex.policies) ? liveIndex.policies : [];
  const livePolicies = Array.isArray(livePoliciesPayload.policies)
    ? livePoliciesPayload.policies
    : [];
  const draftPolicies = Array.isArray(draftPoliciesPayload.policies)
    ? draftPoliciesPayload.policies
    : [];

  const liveById = new Map();
  const draftById = new Map();

  for (const policy of livePolicies) {
    liveById.set(String(policy.policy_id), policy);
  }

  for (const policy of draftPolicies) {
    draftById.set(String(policy.policy_id), policy);
  }

  return {
    liveIndexPolicies,
    livePolicies,
    draftPolicies,
    liveById,
    draftById,
  };
}

function extractExcerpt(policy) {
  if (!policy || typeof policy !== "object") {
    return null;
  }

  const sections = policy.sections;
  if (sections && typeof sections === "object") {
    const summary = sections.Summary || sections.summary;
    if (typeof summary === "string" && summary.trim()) {
      return summary.trim().slice(0, 220);
    }
  }

  const raw = normalizeString(policy.raw_markdown);
  if (!raw) {
    return null;
  }

  return raw
    .replace(/^---[\s\S]*?---/, "")
    .replace(/`{3}[\s\S]*?`{3}/g, " ")
    .replace(/[#>*_`[\]\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function makeSearchableText(candidate) {
  const tags = Array.isArray(candidate.tags) ? candidate.tags.join(" ") : "";
  return [
    candidate.policy_id,
    candidate.title,
    candidate.status,
    candidate.type,
    candidate.visibility,
    candidate.path,
    tags,
    candidate.excerpt,
  ]
    .map((value) => normalizeString(value).toLowerCase())
    .join(" ");
}

function scoreCandidate(query, text, policyId, title) {
  const normalizedQuery = normalizeString(query).toLowerCase();
  if (!normalizedQuery) {
    return 0;
  }

  const tokens = Array.from(
    new Set(normalizedQuery.split(/\s+/).map((token) => token.trim()).filter(Boolean))
  );

  let score = 0;
  if (text.includes(normalizedQuery)) {
    score += 5;
  }

  const lowerPolicyId = normalizeString(policyId).toLowerCase();
  const lowerTitle = normalizeString(title).toLowerCase();

  if (lowerPolicyId === normalizedQuery) {
    score += 4;
  }
  if (lowerTitle.includes(normalizedQuery)) {
    score += 2;
  }

  for (const token of tokens) {
    if (text.includes(token)) {
      score += 1;
    }
  }

  return score;
}

function buildLiveCandidates(liveIndexPolicies, liveById) {
  const candidates = [];
  for (const item of liveIndexPolicies) {
    const policyId = String(item.policy_id || "");
    const fullPolicy = liveById.get(policyId);
    candidates.push({
      source: "live",
      policy_id: policyId,
      title: item.title || fullPolicy?.title || "",
      status: item.status || fullPolicy?.status || "",
      type: item.type || fullPolicy?.type || "",
      visibility: item.visibility ?? fullPolicy?.visibility ?? null,
      path: item.path || fullPolicy?.path || "",
      tags: item.tags || fullPolicy?.tags || [],
      excerpt: extractExcerpt(fullPolicy),
    });
  }
  return candidates;
}

function buildDraftCandidates(draftPolicies) {
  return draftPolicies.map((policy) => ({
    source: "draft",
    policy_id: String(policy.policy_id || ""),
    title: policy.title || "",
    status: policy.status || "",
    type: policy.type || "",
    visibility: policy.visibility ?? null,
    path: policy.path || "",
    tags: policy.tags || [],
    excerpt: extractExcerpt(policy),
  }));
}

function validateSearchBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a JSON object.";
  }

  if (typeof body.query !== "string" || body.query.trim() === "") {
    return "Field 'query' must be a non-empty string.";
  }

  if (body.k !== undefined) {
    if (!Number.isInteger(body.k) || body.k < 1 || body.k > MAX_K) {
      return `Field 'k' must be an integer between 1 and ${MAX_K}.`;
    }
  }

  if (body.scope !== undefined && body.scope !== "internal" && body.scope !== "customer") {
    return "Field 'scope' must be 'internal' or 'customer' when provided.";
  }

  return null;
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let totalBytes = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(new Error("REQUEST_BODY_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function sortByRelevance(a, b) {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  return String(a.title).localeCompare(String(b.title));
}

function cleanPlainText(value) {
  return normalizeString(value).replace(/\s+/g, " ").trim();
}

function normalizeHeadingText(heading) {
  return cleanPlainText(heading).toLowerCase().replace(/\s+/g, " ");
}

function buildStableSectionId(policyId, heading) {
  return crypto
    .createHash("sha256")
    .update(`${String(policyId || "")}||${normalizeHeadingText(String(heading || ""))}`)
    .digest("hex");
}

function truncateText(value, maxLength = 220) {
  const text = cleanPlainText(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function stripFrontmatter(markdown) {
  return normalizeString(markdown).replace(/^---[\s\S]*?---\s*/, "");
}

function extractPolicySections(policy) {
  const sections = policy?.sections;
  if (Array.isArray(sections)) {
    return sections
      .map((section) => ({
        section_id:
          cleanPlainText(section?.section_id) ||
          buildStableSectionId(policy?.policy_id, section?.heading),
        heading: cleanPlainText(section?.heading),
        content: cleanPlainText(section?.content),
      }))
      .filter((section) => section.heading && section.content);
  }

  if (sections && typeof sections === "object") {
    return Object.entries(sections)
      .map(([heading, value]) => {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          return {
            section_id:
              cleanPlainText(value.section_id) ||
              buildStableSectionId(policy?.policy_id, heading),
            heading: cleanPlainText(heading),
            content: cleanPlainText(value.content),
          };
        }

        return {
          section_id: buildStableSectionId(policy?.policy_id, heading),
          heading: cleanPlainText(heading),
          content: cleanPlainText(value),
        };
      })
      .filter((section) => section.heading && section.content);
  }

  return [];
}

function buildAnswerChunks(policies, source) {
  const chunks = [];

  for (const policy of policies) {
    const policyId = String(policy.policy_id || "");
    const policyTitle = cleanPlainText(policy.title);
    const policyPath = cleanPlainText(policy.path);
    let addedForPolicy = 0;

    const sectionEntries = extractPolicySections(policy);
    for (const section of sectionEntries) {
      chunks.push({
        source,
        policy_id: policyId,
        title: policyTitle,
        path: policyPath,
        section_heading: section.heading,
        section_id: section.section_id,
        text: section.content,
      });
      addedForPolicy += 1;
    }

    if (addedForPolicy === 0) {
      const rawBody = cleanPlainText(stripFrontmatter(policy.raw_markdown));
      if (rawBody) {
        chunks.push({
          source,
          policy_id: policyId,
          title: policyTitle,
          path: policyPath,
          section_heading: "Policy",
          section_id: buildStableSectionId(policyId, "Policy"),
          text: rawBody,
        });
      }
    }
  }

  return chunks;
}

function scoreAnswerChunk(question, chunk) {
  const normalizedQuestion = cleanPlainText(question).toLowerCase();
  if (!normalizedQuestion) {
    return 0;
  }

  const tokens = Array.from(
    new Set(normalizedQuestion.split(/\s+/).map((token) => token.trim()).filter(Boolean))
  );

  const titleText = cleanPlainText(chunk.title).toLowerCase();
  const headingText = cleanPlainText(chunk.section_heading).toLowerCase();
  const bodyText = cleanPlainText(chunk.text).toLowerCase();
  const combinedText = `${titleText} ${headingText} ${bodyText}`;

  let score = 0;
  let tokenHits = 0;

  if (combinedText.includes(normalizedQuestion)) {
    score += 6;
  }

  for (const token of tokens) {
    let matched = false;
    if (titleText.includes(token)) {
      score += 2;
      matched = true;
    }
    if (headingText.includes(token)) {
      score += 2;
      matched = true;
    }
    if (bodyText.includes(token)) {
      score += 1;
      matched = true;
    }
    if (matched) {
      tokenHits += 1;
    }
  }

  if (tokens.length > 0) {
    score += tokenHits / tokens.length;
  }

  return score;
}

function rankAnswerChunks(chunks, question) {
  return chunks
    .map((chunk) => ({
      ...chunk,
      score: scoreAnswerChunk(question, chunk),
      excerpt: truncateText(chunk.text, 220),
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (a.policy_id !== b.policy_id) {
        return String(a.policy_id).localeCompare(String(b.policy_id));
      }
      return String(a.section_heading).localeCompare(String(b.section_heading));
    });
}

function assertCitationCompleteness(citations, scope) {
  const requiredFields = ["policy_id", "path", "section_heading", "section_id", "excerpt"];

  for (const [index, citation] of citations.entries()) {
    const missing = requiredFields.filter((field) => {
      const value = citation[field];
      return typeof value !== "string" || value.trim() === "";
    });

    if (missing.length > 0) {
      const message = `Incomplete citation at index ${index}: missing ${missing.join(", ")}.`;
      if (scope === "internal") {
        throw new Error(message);
      }
      throw new Error("Citation completeness validation failed.");
    }
  }
}

function pickAnswerCitations(scope, question, maxCitations, data) {
  const livePoliciesForScope = data.livePolicies.filter((policy) =>
    isPolicyAllowedForScope(scope, "live", policy.visibility, false)
  );

  const liveChunks = buildAnswerChunks(livePoliciesForScope, "live");
  const rankedLive = rankAnswerChunks(liveChunks, question);
  const topLiveScore = rankedLive[0]?.score ?? 0;
  const shouldUseDraftFallback =
    scope === "internal" &&
    (rankedLive.length === 0 || topLiveScore < ANSWER_LIVE_RELEVANCE_THRESHOLD);
  const liveRetrievedPolicyIds = Array.from(
    new Set(rankedLive.map((chunk) => chunk.policy_id))
  );

  logInternalDebug(scope, "answer.live_retrieval", {
    question,
    top_live_score: topLiveScore,
    threshold: ANSWER_LIVE_RELEVANCE_THRESHOLD,
    live_retrieved_policy_ids: liveRetrievedPolicyIds,
    fallback_triggered: shouldUseDraftFallback,
    fallback_reason:
      rankedLive.length === 0
        ? "no_live_results"
        : topLiveScore < ANSWER_LIVE_RELEVANCE_THRESHOLD
          ? "top_live_score_below_threshold"
          : "not_triggered",
  });

  if (!shouldUseDraftFallback && rankedLive.length > 0) {
    return {
      citations: rankedLive.slice(0, maxCitations),
      usedDraft: false,
    };
  }

  if (shouldUseDraftFallback) {
    const draftPoliciesForScope = data.draftPolicies.filter((policy) =>
      isPolicyAllowedForScope(scope, "draft", policy.visibility, true)
    );
    const draftChunks = buildAnswerChunks(draftPoliciesForScope, "draft");
    const rankedDraft = rankAnswerChunks(draftChunks, question);
    const draftRetrievedPolicyIds = Array.from(
      new Set(rankedDraft.map((chunk) => chunk.policy_id))
    );
    logInternalDebug(scope, "answer.draft_retrieval", {
      question,
      draft_retrieved_policy_ids: draftRetrievedPolicyIds,
      top_draft_score: rankedDraft[0]?.score ?? 0,
      threshold: ANSWER_LIVE_RELEVANCE_THRESHOLD,
    });
    if (rankedDraft.length > 0) {
      return {
        citations: rankedDraft.slice(0, maxCitations),
        usedDraft: true,
      };
    }
  }

  if (rankedLive.length > 0) {
    return {
      citations: rankedLive.slice(0, maxCitations),
      usedDraft: false,
    };
  }

  return { citations: [], usedDraft: false };
}

function buildAnswerText(citations, scope, usedDraft) {
  if (citations.length === 0) {
    if (scope === "customer") {
      return "I could not find a relevant public live policy for that question.";
    }
    return "I could not find a relevant policy section for that question.";
  }

  const intro = usedDraft
    ? "No live policy met the relevance threshold, so this answer uses draft policy guidance:"
    : "Based on relevant policy sections:";

  const lines = citations.map(
    (citation, index) =>
      `${index + 1}. [${citation.policy_id}] ${citation.section_heading}: ${citation.excerpt}`
  );

  return `${intro}\n${lines.join("\n")}`;
}

async function handleSearch(req, res, requestId, scope) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    if (error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE") {
      sendError(
        res,
        400,
        "INVALID_REQUEST",
        "Request body is too large.",
        requestId
      );
      return;
    }
    sendError(res, 400, "INVALID_JSON", "Request body must be valid JSON.", requestId);
    return;
  }

  const validationError = validateSearchBody(body);
  if (validationError) {
    sendError(res, 400, "INVALID_REQUEST", validationError, requestId);
    return;
  }

  const query = body.query.trim();
  const k = body.k ?? DEFAULT_K;
  const data = await loadExportData();

  const liveCandidates = buildLiveCandidates(data.liveIndexPolicies, data.liveById);
  const scopedLiveCandidates = liveCandidates.filter((candidate) =>
    isPolicyAllowedForScope(scope, "live", candidate.visibility, false)
  );
  const scoredLive = scopedLiveCandidates
    .map((candidate) => {
      const text = makeSearchableText(candidate);
      const score = scoreCandidate(query, text, candidate.policy_id, candidate.title);
      return { ...candidate, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort(sortByRelevance);

  let scoredDraft = [];
  if (scope === "internal") {
    const topLiveScore = scoredLive[0]?.score ?? 0;
    const shouldUseDraftFallback =
      scoredLive.length === 0 || topLiveScore < SEARCH_LIVE_RELEVANCE_THRESHOLD;

    if (shouldUseDraftFallback) {
      const draftCandidates = buildDraftCandidates(data.draftPolicies).filter((candidate) =>
        isPolicyAllowedForScope(scope, "draft", candidate.visibility, true)
      );
      scoredDraft = draftCandidates
        .map((candidate) => {
          const text = makeSearchableText(candidate);
          const score = scoreCandidate(query, text, candidate.policy_id, candidate.title);
          return { ...candidate, score };
        })
        .filter((candidate) => candidate.score > 0)
        .sort(sortByRelevance);
    }
  }

  const ordered = [...scoredLive, ...scoredDraft]
    .filter((candidate) => candidate.score > 0);

  const results = ordered.slice(0, k).map((candidate) => ({
    policy_id: candidate.policy_id,
    title: candidate.title,
    status: candidate.status,
    type: candidate.type,
    visibility: candidate.visibility,
    path: candidate.path,
    excerpt: candidate.excerpt || null,
    score: Number(candidate.score.toFixed(3)),
  }));

  sendJson(res, 200, { results }, requestId);
}

async function handleGetPolicy(req, res, requestId, scope, urlPath) {
  const prefix = "/v1/kb/policy/";
  const rawPolicyId = decodeURIComponent(urlPath.slice(prefix.length));
  const policyId = normalizeString(rawPolicyId);
  if (!policyId) {
    sendError(
      res,
      400,
      "INVALID_REQUEST",
      "Path parameter 'policy_id' is required.",
      requestId
    );
    return;
  }

  const data = await loadExportData();

  let found = null;
  const livePolicy = data.liveById.get(policyId) || null;
  if (
    livePolicy &&
    isPolicyAllowedForScope(scope, "live", livePolicy.visibility, false)
  ) {
    found = livePolicy;
  } else {
    const draftPolicy = data.draftById.get(policyId) || null;
    if (
      draftPolicy &&
      isPolicyAllowedForScope(scope, "draft", draftPolicy.visibility, true)
    ) {
      found = draftPolicy;
    }
  }

  if (!found) {
    sendError(
      res,
      404,
      "POLICY_NOT_FOUND",
      `Policy '${policyId}' was not found for scope '${scope}'.`,
      requestId
    );
    return;
  }

  sendJson(res, 200, found, requestId);
}

async function handleAnswer(req, res, requestId) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    if (error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE") {
      sendError(
        res,
        400,
        "INVALID_REQUEST",
        "Request body is too large.",
        requestId
      );
      return;
    }
    sendError(res, 400, "INVALID_JSON", "Request body must be valid JSON.", requestId);
    return;
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    sendError(
      res,
      400,
      "INVALID_REQUEST",
      "Request body must be a JSON object.",
      requestId
    );
    return;
  }

  const question = normalizeString(body.question);
  if (!question) {
    sendError(
      res,
      400,
      "INVALID_REQUEST",
      "Field 'question' must be a non-empty string.",
      requestId
    );
    return;
  }

  const requestedCitations = body.k;
  if (
    requestedCitations !== undefined &&
    (!Number.isInteger(requestedCitations) ||
      requestedCitations < 1 ||
      requestedCitations > MAX_ANSWER_CITATIONS)
  ) {
    sendError(
      res,
      400,
      "INVALID_REQUEST",
      `Field 'k' must be an integer between 1 and ${MAX_ANSWER_CITATIONS}.`,
      requestId
    );
    return;
  }

  const maxCitations = requestedCitations ?? DEFAULT_ANSWER_CITATIONS;
  const scope = resolveScopeFromAuth(req);
  const data = await loadExportData();
  const { citations, usedDraft } = pickAnswerCitations(
    scope,
    question,
    maxCitations,
    data
  );
  const answer = buildAnswerText(citations, scope, usedDraft);
  const responseCitations = citations.map((citation) => ({
    policy_id: citation.policy_id,
    path: citation.path,
    section_heading: citation.section_heading,
    section_id: citation.section_id,
    excerpt: citation.excerpt,
  }));

  try {
    assertCitationCompleteness(responseCitations, scope);
  } catch (error) {
    if (scope === "internal") {
      sendError(
        res,
        500,
        "CITATION_INCOMPLETE",
        error instanceof Error ? error.message : "Citation completeness check failed.",
        requestId
      );
      return;
    }
    throw error;
  }

  sendJson(
    res,
    200,
    {
      answer,
      citations: responseCitations,
      draft_warning: usedDraft,
      draft_warning_message: usedDraft
        ? "Draft policy content was used because no live policy section met the relevance threshold."
        : null,
    },
    requestId
  );
}

async function handleCustomerChatPage(res, requestId) {
  const template = await fs.readFile(CUSTOMER_CHAT_HTML_PATH, "utf8");
  const apiBaseUrl = normalizeString(process.env.NEXT_PUBLIC_KB_API_BASE_URL);
  const html = template.replace(
    "__KB_API_BASE_URL_JSON__",
    JSON.stringify(apiBaseUrl)
  );
  sendHtml(res, 200, html, requestId);
}

async function handleStaffPage(res, requestId) {
  const html = await fs.readFile(STAFF_UI_HTML_PATH, "utf8");
  sendHtml(res, 200, html, requestId);
}

const server = http.createServer(async (req, res) => {
  const requestId = makeRequestId();
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const method = req.method || "GET";
  const pathName = requestUrl.pathname;
  const scope = resolveScopeFromAuth(req);
  const rateLimit = checkCustomerRateLimit(req, scope);

  try {
    if (!rateLimit.allowed) {
      sendError(
        res,
        429,
        "RATE_LIMITED",
        "Too many unauthenticated requests. Please retry shortly.",
        requestId,
        {
          scope: "customer",
          limit: CUSTOMER_RATE_LIMIT_MAX,
          window_ms: CUSTOMER_RATE_LIMIT_WINDOW_MS,
          retry_after_seconds: rateLimit.retryAfterSeconds,
          ip: rateLimit.ip,
        }
      );
      return;
    }

    if (method === "POST" && pathName === "/v1/kb/search") {
      await handleSearch(req, res, requestId, scope);
      return;
    }

    if (method === "GET" && pathName.startsWith("/v1/kb/policy/")) {
      await handleGetPolicy(req, res, requestId, scope, pathName);
      return;
    }

    if (method === "POST" && pathName === "/v1/kb/answer") {
      await handleAnswer(req, res, requestId);
      return;
    }

    if (method === "GET" && (pathName === "/customer-chat" || pathName === "/customer-chat/")) {
      await handleCustomerChatPage(res, requestId);
      return;
    }

    if (method === "GET" && (pathName === "/staff" || pathName === "/staff/")) {
      await handleStaffPage(res, requestId);
      return;
    }

    sendError(
      res,
      404,
      "NOT_FOUND",
      `Route not found: ${method} ${pathName}`,
      requestId
    );
  } catch (error) {
    console.error("KB service error:", error);
    sendError(
      res,
      500,
      "INTERNAL_ERROR",
      "Unexpected server error.",
      requestId
    );
  }
});

server.listen(PORT, () => {
  console.log(`KB service listening on http://localhost:${PORT}`);
});
