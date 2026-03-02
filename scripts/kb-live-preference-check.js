const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const EXPORTS_DIR = path.join(ROOT_DIR, "exports");
const PORT = Number(process.env.KB_LIVE_PREFERENCE_CHECK_PORT || 4025);
const BASE_URL = `http://127.0.0.1:${PORT}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function countOverlap(question, content) {
  const questionTokens = new Set(tokenize(question));
  const contentTokens = new Set(tokenize(content));
  let overlap = 0;
  for (const token of questionTokens) {
    if (contentTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function request(method, route, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body;
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${BASE_URL}${route}`, { method, headers, body });
  const text = await response.text();
  const json = text.trim() ? JSON.parse(text) : null;
  return { status: response.status, json };
}

async function waitForReady(maxAttempts = 40) {
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const response = await request("POST", "/v1/kb/search", {
        body: { query: "refund", k: 1 },
      });
      if (response.status === 200) {
        return;
      }
    } catch {
      // Retry while service starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error("Timed out waiting for KB service startup.");
}

async function run() {
  const [livePayload, draftPayload] = await Promise.all([
    readJson(path.join(EXPORTS_DIR, "policies.json")),
    readJson(path.join(EXPORTS_DIR, "policies-draft.json")),
  ]);

  const livePolicies = Array.isArray(livePayload.policies) ? livePayload.policies : [];
  const draftPolicies = Array.isArray(draftPayload.policies) ? draftPayload.policies : [];
  const livePolicy = livePolicies.find((policy) => policy.visibility === "public");
  const draftPolicy = draftPolicies[0];

  assert(livePolicy, "Expected at least one live public policy.");
  assert(draftPolicy, "Expected at least one draft policy.");

  const question = "refund policy review for faulty merchandise warranty";
  const liveOverlap = countOverlap(question, `${livePolicy.title}\n${livePolicy.raw_markdown}`);
  const draftOverlap = countOverlap(
    question,
    `${draftPolicy.title}\n${draftPolicy.raw_markdown}`
  );
  assert(liveOverlap > 0, "Question did not overlap with live policy text.");
  assert(draftOverlap > 0, "Question did not overlap with draft policy text.");

  const server = spawn(process.execPath, ["apps/kb-service/server.js"], {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: String(PORT), KB_DEBUG: "1" },
    stdio: "pipe",
  });

  server.stdout.on("data", (data) => process.stdout.write(data));
  server.stderr.on("data", (data) => process.stderr.write(data));

  try {
    await waitForReady();

    const response = await request("POST", "/v1/kb/answer", {
      headers: { authorization: "Bearer testtoken" },
      body: { question, k: 3 },
    });

    assert(response.status === 200, "Internal answer should return 200.");
    assert(response.json?.draft_warning === false, "Internal answer should prefer live and avoid draft fallback.");
    assert(
      Array.isArray(response.json?.citations) && response.json.citations.length > 0,
      "Internal answer should include citations."
    );
    assert(
      response.json.citations.every(
        (citation) => typeof citation.path === "string" && citation.path.startsWith("live/")
      ),
      "Internal answer citations should come from live policies only when live is adequate."
    );

    console.log("KB live preference check passed.");
  } finally {
    server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
