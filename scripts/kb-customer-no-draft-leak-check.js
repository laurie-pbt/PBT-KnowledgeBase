const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const CANARY_QUERY = "CANARY_PHRASE_DO_NOT_LEAK_TO_CUSTOMER_SCOPE_9f3d8c7a";
const CANARY_POLICY_ID = "DRAFT-LEAK-001";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to determine free port.")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function request(baseUrl, method, route, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body;
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${baseUrl}${route}`, { method, headers, body });
  const text = await response.text();
  const json = text.trim() ? JSON.parse(text) : null;
  return { status: response.status, json };
}

async function waitForReady(baseUrl, maxAttempts = 40) {
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const response = await request(baseUrl, "POST", "/v1/kb/answer", {
        headers: { authorization: "Bearer healthcheck" },
        body: { question: "ready-check", k: 1 },
      });
      if (response.status === 200) {
        return;
      }
    } catch {
      // Retry while service starts.
    }

    await wait(150);
  }

  throw new Error("Timed out waiting for KB service startup.");
}

async function run() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const server = spawn(process.execPath, ["apps/kb-service/server.js"], {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: String(port) },
    stdio: "pipe",
  });

  server.stdout.on("data", (data) => process.stdout.write(data));
  server.stderr.on("data", (data) => process.stderr.write(data));

  try {
    await waitForReady(baseUrl);

    // Customer scope is enforced by omitting Authorization header.
    const answer = await request(baseUrl, "POST", "/v1/kb/answer", {
      body: { question: CANARY_QUERY, k: 5 },
    });

    assert(answer.status === 200, "Customer canary query should return 200.");
    assert(answer.json && typeof answer.json === "object", "Answer payload must be an object.");

    const citations = Array.isArray(answer.json.citations) ? answer.json.citations : [];
    for (const citation of citations) {
      assert(
        citation.policy_id !== CANARY_POLICY_ID,
        "Customer scope leaked canary policy_id in citations."
      );
      assert(
        typeof citation.path !== "string" || !citation.path.startsWith("draft/"),
        "Customer scope leaked a draft citation path."
      );
    }

    assert(
      answer.json.draft_warning !== true,
      "Customer scope must never report draft fallback usage."
    );

    console.log("KB customer no-draft-leak check passed.");
  } finally {
    server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
