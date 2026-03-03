const path = require("path");
const { spawn } = require("child_process");
const { assertGovernance } = require("../../scripts/kb-answer-smoke.js");

const ROOT_DIR = path.resolve(__dirname, "../..");
const PORT = Number(process.env.KB_ANSWER_CHECK_PORT || 4021);
const BASE_URL = `http://127.0.0.1:${PORT}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

async function waitUntilReady(maxAttempts = 40) {
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const res = await request("POST", "/v1/kb/search", {
        body: { query: "refund", k: 1 },
      });
      if (res.status === 200) {
        return;
      }
    } catch {
      // Wait and retry.
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error("Timed out waiting for KB service to start.");
}

async function run() {
  const server = spawn(process.execPath, ["apps/kb-service/server.js"], {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "pipe",
  });

  server.stdout.on("data", (data) => {
    const message = data.toString("utf8").trimEnd();
    if (message) {
      console.log(message);
    }
  });
  server.stderr.on("data", (data) => process.stderr.write(data));

  try {
    await waitUntilReady();

    const internalLive = await request("POST", "/v1/kb/answer", {
      headers: { authorization: "Bearer internal-token" },
      body: { question: "manufacturing defects warranty", k: 2 },
    });

    assert(internalLive.status === 200, "Internal live answer should return 200.");
    assert(Array.isArray(internalLive.json.citations), "Internal live answer must include citations.");
    assert(internalLive.json.citations.length > 0, "Internal live answer should have at least one citation.");
    assert(
      internalLive.json.citations.every((c) => typeof c.path === "string" && c.path.startsWith("live/")),
      "Internal live answer should cite live policies for this query."
    );
    assert(
      internalLive.json.draft_warning === false,
      "Internal live answer should not set draft warning."
    );
    assertGovernance(internalLive.json);

    const originalLog = console.log;
    let logBuffer = [];
    console.log = (msg) => {
      logBuffer.push(msg);
      originalLog(msg);
    };

    let internalDraftFallback;
    try {
      internalDraftFallback = await request("POST", "/v1/kb/answer", {
        headers: { authorization: "Bearer internal-token" },
        body: { question: "not yet effective draft policy under review", k: 2, scope: "customer" },
      });
    } finally {
      console.log = originalLog;
    }

    assert(internalDraftFallback.status === 200, "Internal draft fallback answer should return 200.");
    assert(
      Array.isArray(internalDraftFallback.json.citations),
      "Internal draft fallback must include citations."
    );
    assert(
      internalDraftFallback.json.citations.length > 0,
      "Internal draft fallback should return at least one citation."
    );
    assert(
      internalDraftFallback.json.citations.some(
        (citation) => typeof citation.path === "string" && citation.path.startsWith("draft/")
      ),
      "Internal draft fallback should include at least one draft citation."
    );
    assert(
      internalDraftFallback.json.draft_warning === true,
      "Internal draft fallback should set draft_warning=true."
    );
    assert(
      typeof internalDraftFallback.json.draft_warning_message === "string" &&
        internalDraftFallback.json.draft_warning_message.length > 0,
      "Internal draft fallback should include draft_warning_message."
    );
    assertGovernance(internalDraftFallback.json);

    const draftLog = logBuffer.find((l) => l.includes('"event":"draft_used"'));
    if (!draftLog) {
      throw new Error("Draft usage event not logged");
    }

    const customerDraftBlocked = await request("POST", "/v1/kb/answer", {
      body: { question: "not yet effective draft policy under review", k: 2 },
    });

    assert(customerDraftBlocked.status === 200, "Customer answer should return 200.");
    assert(
      Array.isArray(customerDraftBlocked.json.citations),
      "Customer answer must include citations."
    );
    assert(
      customerDraftBlocked.json.citations.every(
        (citation) => typeof citation.path === "string" && citation.path.startsWith("live/")
      ),
      "Customer answer must never cite draft policies."
    );
    assert(
      customerDraftBlocked.json.draft_warning === false,
      "Customer answer must not set draft warning."
    );
    assertGovernance(customerDraftBlocked.json);
    assert(
      customerDraftBlocked.json.governance.source !== "draft",
      "Customer answer governance.source must never be draft."
    );

    console.log("KB answer self-check passed.");
  } finally {
    server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
