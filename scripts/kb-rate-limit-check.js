const path = require("path");
const { spawn } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.env.KB_RATE_LIMIT_CHECK_PORT || 4027);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const LIMIT = 5;

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
        headers: { authorization: "Bearer testtoken" },
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
  const server = spawn(process.execPath, ["apps/kb-service/server.js"], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      KB_CUSTOMER_RATE_LIMIT_MAX: String(LIMIT),
      KB_CUSTOMER_RATE_LIMIT_WINDOW_MS: "60000",
    },
    stdio: "pipe",
  });

  server.stdout.on("data", (data) => process.stdout.write(data));
  server.stderr.on("data", (data) => process.stderr.write(data));

  try {
    await waitForReady();

    // Consume the full customer allowance.
    for (let i = 0; i < LIMIT; i += 1) {
      const ok = await request("POST", "/v1/kb/search", {
        body: { query: "refund", k: 1 },
      });
      assert(ok.status === 200, `Expected customer request ${i + 1} to return 200.`);
    }

    // Next customer request must be rate limited.
    const limited = await request("POST", "/v1/kb/search", {
      body: { query: "refund", k: 1 },
    });
    assert(limited.status === 429, "Expected customer request above limit to return 429.");
    assert(limited.json?.code === "RATE_LIMITED", "Expected RATE_LIMITED error code.");
    assert(typeof limited.json?.message === "string", "Expected rate limit error message.");
    assert(typeof limited.json?.requestId === "string", "Expected rate limit requestId.");

    // Internal should still be allowed.
    const internal = await request("POST", "/v1/kb/search", {
      headers: { authorization: "Bearer testtoken" },
      body: { query: "refund", k: 1 },
    });
    assert(internal.status === 200, "Expected internal request to bypass customer rate limit.");

    console.log("KB rate limit check passed.");
  } finally {
    server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
