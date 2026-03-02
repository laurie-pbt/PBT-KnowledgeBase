const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const fg = require("fast-glob");
const matter = require("gray-matter");

const ROOT_DIR = path.resolve(__dirname, "..");
const EXPORTS_DIR = path.join(ROOT_DIR, "exports");
const PORT = Number(process.env.KB_SCOPE_CHECK_PORT || 4023);
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
  return { status: response.status, json };
}

async function waitForReady(maxAttempts = 40) {
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const response = await request("POST", "/v1/kb/search", {
        body: { query: "ready", k: 1 },
      });
      if (response.status === 200) {
        return;
      }
    } catch {
      // Retry while server starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error("Timed out waiting for KB service startup.");
}

async function findInternalLivePolicyIdFixture() {
  const files = await fg(["live/perpetual/**/*.md", "live/temporary/**/*.md"], {
    cwd: ROOT_DIR,
    absolute: true,
  });
  files.sort();

  for (const filePath of files) {
    const raw = await fs.readFile(filePath, "utf8");
    const data = matter(raw).data || {};
    if (data.visibility === "internal" && typeof data.policy_id === "string") {
      return data.policy_id;
    }
  }

  return null;
}

async function run() {
  const [livePayload, draftPayload] = await Promise.all([
    readJson(path.join(EXPORTS_DIR, "policies.json")),
    readJson(path.join(EXPORTS_DIR, "policies-draft.json")),
  ]);

  const livePolicies = Array.isArray(livePayload.policies) ? livePayload.policies : [];
  const draftPolicies = Array.isArray(draftPayload.policies) ? draftPayload.policies : [];
  const draftPolicy = draftPolicies[0];
  const internalLiveFromExport = livePolicies.find((policy) => policy.visibility === "internal");
  const internalLiveFixtureId =
    internalLiveFromExport?.policy_id || (await findInternalLivePolicyIdFixture());

  assert(draftPolicy, "Expected at least one draft policy for scope regression checks.");
  assert(internalLiveFixtureId, "Expected an internal live policy fixture id.");

  const server = spawn(process.execPath, ["apps/kb-service/server.js"], {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "pipe",
  });

  server.stdout.on("data", (data) => process.stdout.write(data));
  server.stderr.on("data", (data) => process.stderr.write(data));

  try {
    await waitForReady();

    // A) customer search returns only live+public and body scope cannot elevate.
    const customerSearch = await request("POST", "/v1/kb/search", {
      body: { query: "merchandise", k: 20, scope: "internal" },
    });
    assert(customerSearch.status === 200, "Customer search should return 200.");
    assert(Array.isArray(customerSearch.json.results), "Customer search results must be array.");
    for (const result of customerSearch.json.results) {
      assert(
        typeof result.path === "string" && result.path.startsWith("live/"),
        "Customer search returned non-live result."
      );
      assert(result.visibility === "public", "Customer search returned non-public result.");
    }

    // B) customer cannot fetch draft policy.
    const customerDraft = await request(
      "GET",
      `/v1/kb/policy/${encodeURIComponent(draftPolicy.policy_id)}`
    );
    assert(
      customerDraft.status === 404 || customerDraft.status === 403,
      "Customer draft policy fetch should be denied."
    );

    // C) customer cannot fetch internal live policy fixture.
    const customerInternal = await request(
      "GET",
      `/v1/kb/policy/${encodeURIComponent(internalLiveFixtureId)}`
    );
    assert(
      customerInternal.status === 404 || customerInternal.status === 403,
      "Customer internal live policy fetch should be denied."
    );

    // D) internal answer draft fallback only when live retrieval is weak.
    const internalStrongLive = await request("POST", "/v1/kb/answer", {
      headers: { authorization: "Bearer testtoken" },
      body: { question: "manufacturing defects warranty", k: 2, scope: "customer" },
    });
    assert(internalStrongLive.status === 200, "Internal strong answer should return 200.");
    assert(
      internalStrongLive.json.draft_warning === false,
      "Internal strong answer should not trigger draft fallback."
    );
    assert(
      Array.isArray(internalStrongLive.json.citations) &&
        internalStrongLive.json.citations.every(
          (citation) =>
            typeof citation.path === "string" && citation.path.startsWith("live/")
        ),
      "Internal strong answer should cite live policies only."
    );

    const internalWeakFallback = await request("POST", "/v1/kb/answer", {
      headers: { authorization: "Bearer testtoken" },
      body: { question: "not yet effective draft policy under review", k: 2 },
    });
    assert(internalWeakFallback.status === 200, "Internal fallback answer should return 200.");
    assert(
      internalWeakFallback.json.draft_warning === true,
      "Internal weak answer should trigger draft fallback warning."
    );
    assert(
      typeof internalWeakFallback.json.draft_warning_message === "string" &&
        internalWeakFallback.json.draft_warning_message.length > 0,
      "Internal weak answer should include draft warning message."
    );
    assert(
      Array.isArray(internalWeakFallback.json.citations) &&
        internalWeakFallback.json.citations.some(
          (citation) =>
            typeof citation.path === "string" && citation.path.startsWith("draft/")
        ),
      "Internal weak answer should include draft citations."
    );

    console.log("KB scope regression check passed.");
  } finally {
    server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
