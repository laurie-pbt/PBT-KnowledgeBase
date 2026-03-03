const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const STAFF_TOKEN = (process.env.KB_STAFF_TOKEN || "").trim();

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

async function waitForReady(baseUrl, maxAttempts = 40) {
  const headers = STAFF_TOKEN
    ? { authorization: `Bearer ${STAFF_TOKEN}` }
    : undefined;

  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const response = await fetch(`${baseUrl}/staff`, { headers });
      if (response.status === 200) {
        return;
      }
    } catch {
      // Retry while service is starting.
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

    const headers = STAFF_TOKEN
      ? { authorization: `Bearer ${STAFF_TOKEN}` }
      : undefined;
    const response = await fetch(`${baseUrl}/staff`, { headers });
    const html = await response.text();
    assert(response.status === 200, "Expected /staff to return 200.");
    assert(html.includes("Staff v1"), "Expected /staff page to contain 'Staff v1' marker.");

    console.log("KB staff UI smoke check passed.");
  } finally {
    server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
