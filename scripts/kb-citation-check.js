const path = require("path");
const { spawn } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.env.KB_CITATION_CHECK_PORT || 4024);
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

function validateCitation(citation, index) {
  const required = ["policy_id", "path", "section_heading", "section_id", "excerpt"];
  for (const field of required) {
    assert(
      typeof citation[field] === "string" && citation[field].trim() !== "",
      `Citation ${index} missing required field '${field}'.`
    );
  }
}

async function run() {
  const server = spawn(process.execPath, ["apps/kb-service/server.js"], {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "pipe",
  });

  server.stdout.on("data", (data) => process.stdout.write(data));
  server.stderr.on("data", (data) => process.stderr.write(data));

  try {
    await waitForReady();

    const queryBody = {
      question: "What is the refund and warranty policy for faulty merchandise?",
      k: 3,
    };

    const first = await request("POST", "/v1/kb/answer", { body: queryBody });
    const second = await request("POST", "/v1/kb/answer", { body: queryBody });

    assert(first.status === 200, "First /v1/kb/answer call should return 200.");
    assert(second.status === 200, "Second /v1/kb/answer call should return 200.");
    assert(Array.isArray(first.json?.citations), "First response missing citations array.");
    assert(Array.isArray(second.json?.citations), "Second response missing citations array.");
    assert(first.json.citations.length > 0, "Expected at least one citation in first response.");
    assert(
      first.json.citations.length === second.json.citations.length,
      "Citation count differs between repeated calls."
    );

    for (const [index, citation] of first.json.citations.entries()) {
      validateCitation(citation, index);
      assert(
        citation.path.startsWith("live/"),
        "Customer answer citation should reference live policy."
      );
    }

    const firstIds = first.json.citations.map((citation) => citation.section_id);
    const secondIds = second.json.citations.map((citation) => citation.section_id);
    assert(
      JSON.stringify(firstIds) === JSON.stringify(secondIds),
      "section_id sequence is not stable across repeated calls."
    );

    console.log("KB citation check passed.");
  } finally {
    server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
