const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const EXPORTS_DIR = path.join(ROOT_DIR, "exports");
const PORT = Number(process.env.KB_CUSTOMER_CHAT_SMOKE_PORT || 4026);
const BASE_URL = `http://127.0.0.1:${PORT}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
  return { status: response.status, json, text };
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
      // Retry
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error("Timed out waiting for KB service startup.");
}

async function run() {
  const livePayload = await readJson(path.join(EXPORTS_DIR, "policies.json"));
  const livePolicies = Array.isArray(livePayload.policies) ? livePayload.policies : [];
  const pathVisibility = new Map();
  for (const policy of livePolicies) {
    pathVisibility.set(policy.path, policy.visibility);
  }

  const server = spawn(process.execPath, ["apps/kb-service/server.js"], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      NEXT_PUBLIC_KB_API_BASE_URL: BASE_URL,
    },
    stdio: "pipe",
  });

  server.stdout.on("data", (data) => process.stdout.write(data));
  server.stderr.on("data", (data) => process.stderr.write(data));

  try {
    await waitForReady();

    const chatPage = await fetch(`${BASE_URL}/customer-chat`);
    const chatHtml = await chatPage.text();
    assert(chatPage.status === 200, "Customer chat page should return 200.");
    assert(chatHtml.includes("Customer KB Chat"), "Customer chat page missing expected title.");
    assert(chatHtml.includes("Sources"), "Customer chat page should include Sources UI.");

    const answerResponse = await request("POST", "/v1/kb/answer", {
      body: { question: "Can I return a faulty item for a refund?", k: 3 },
    });

    assert(answerResponse.status === 200, "Customer /v1/kb/answer should return 200.");
    assert(
      answerResponse.json && typeof answerResponse.json.answer === "string",
      "Customer /v1/kb/answer should return answer text."
    );
    assert(
      Array.isArray(answerResponse.json.citations) && answerResponse.json.citations.length > 0,
      "Customer /v1/kb/answer should return citations."
    );

    for (const citation of answerResponse.json.citations) {
      assert(
        typeof citation.path === "string" && citation.path.startsWith("live/"),
        "Customer citation must reference live policies only."
      );
      assert(
        pathVisibility.get(citation.path) === "public",
        `Customer citation must reference public live policy only (path: ${citation.path}).`
      );
    }

    console.log("KB customer chat smoke check passed.");
  } finally {
    server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
