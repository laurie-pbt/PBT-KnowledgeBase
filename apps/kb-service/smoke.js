const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

const PORT = Number(process.env.KB_SMOKE_PORT || 4020);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ROOT_DIR = path.resolve(__dirname, "../..");
const EXPORTS_DIR = path.join(ROOT_DIR, "exports");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(fileName) {
  const filePath = path.join(EXPORTS_DIR, fileName);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function request(method, route, options = {}) {
  const headers = Object.assign({}, options.headers);
  let body;
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const res = await fetch(`${BASE_URL}${route}`, { method, headers, body });
  const text = await res.text();
  let json = null;
  if (text.trim()) {
    json = JSON.parse(text);
  }
  return { status: res.status, json };
}

async function waitForServerReady(maxAttempts = 40) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await request("POST", "/v1/kb/answer", {
        body: { question: "ready-check" },
      });
      if (response.status >= 200 && response.status < 500) {
        return;
      }
    } catch {
      // Ignore until service is reachable.
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error("Timed out waiting for KB service to start.");
}

function validateErrorShape(payload, expectedCode) {
  assert(payload && typeof payload === "object", "Error payload must be an object.");
  assert(payload.code === expectedCode, `Expected error code '${expectedCode}'.`);
  assert(typeof payload.message === "string", "Error payload must include message.");
  assert(typeof payload.requestId === "string", "Error payload must include requestId.");
}

async function runSmokeTests() {
  const [livePayload, draftPayload] = await Promise.all([
    readJson("policies.json"),
    readJson("policies-draft.json"),
  ]);

  const livePolicies = Array.isArray(livePayload.policies) ? livePayload.policies : [];
  const draftPolicies = Array.isArray(draftPayload.policies) ? draftPayload.policies : [];

  const livePublic = livePolicies.find((policy) => policy.visibility === "public");
  const draftAny = draftPolicies[0];

  assert(livePublic, "Expected at least one live public policy in exports/policies.json.");

  const server = spawn(process.execPath, ["apps/kb-service/server.js"], {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "pipe",
  });

  server.stdout.on("data", (data) => process.stdout.write(data));
  server.stderr.on("data", (data) => process.stderr.write(data));

  try {
    await waitForServerReady();

    const customerSearch = await request("POST", "/v1/kb/search", {
      body: { query: "merchandise", k: 20, scope: "internal" },
    });
    assert(customerSearch.status === 200, "Customer search should return 200.");
    assert(Array.isArray(customerSearch.json.results), "Customer search results must be an array.");
    for (const item of customerSearch.json.results) {
      assert(
        typeof item.path === "string" && item.path.startsWith("live/"),
        "Customer search must only return live policies."
      );
      assert(item.visibility === "public", "Customer search must only return public policies.");
    }

    const internalSearch = await request("POST", "/v1/kb/search", {
      headers: { authorization: "Bearer smoke-token" },
      body: { query: "merchandise", k: 20, scope: "customer" },
    });
    assert(internalSearch.status === 200, "Internal search should return 200.");
    assert(Array.isArray(internalSearch.json.results), "Internal search results must be an array.");

    const hasLive = internalSearch.json.results.some(
      (item) => typeof item.path === "string" && item.path.startsWith("live/")
    );
    const hasDraft = internalSearch.json.results.some(
      (item) => typeof item.path === "string" && item.path.startsWith("draft/")
    );

    if (hasLive && hasDraft) {
      let seenDraft = false;
      for (const item of internalSearch.json.results) {
        const isLive = item.path.startsWith("live/");
        const isDraft = item.path.startsWith("draft/");
        if (isDraft) {
          seenDraft = true;
        }
        if (isLive && seenDraft) {
          throw new Error("Internal search must prioritize live results before draft results.");
        }
      }
    }

    const customerPolicy = await request("GET", `/v1/kb/policy/${livePublic.policy_id}`);
    assert(customerPolicy.status === 200, "Customer should be able to read live public policy.");
    assert(
      customerPolicy.json.policy_id === livePublic.policy_id,
      "Customer policy response returned unexpected policy."
    );

    if (draftAny) {
      const deniedDraft = await request("GET", `/v1/kb/policy/${draftAny.policy_id}`);
      assert(deniedDraft.status === 404, "Customer should not be able to read draft policy.");
      validateErrorShape(deniedDraft.json, "POLICY_NOT_FOUND");

      const internalDraft = await request("GET", `/v1/kb/policy/${draftAny.policy_id}`, {
        headers: { authorization: "Bearer smoke-token" },
      });
      assert(internalDraft.status === 200, "Internal scope should be able to read draft policy.");
      assert(
        internalDraft.json.policy_id === draftAny.policy_id,
        "Internal draft policy response returned unexpected policy."
      );
    }

    const answerResponse = await request("POST", "/v1/kb/answer", {
      body: { question: "What is the refund policy?" },
    });
    assert(answerResponse.status === 200, "Answer endpoint should return 200.");
    assert(
      answerResponse.json && typeof answerResponse.json.answer === "string",
      "Answer endpoint must return answer text."
    );
    assert(
      Array.isArray(answerResponse.json.citations),
      "Answer endpoint must return citations array."
    );

    console.log("KB smoke tests passed.");
  } finally {
    server.kill("SIGTERM");
  }
}

runSmokeTests().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
