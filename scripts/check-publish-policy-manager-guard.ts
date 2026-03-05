import { spawnSync } from "child_process";
import path from "path";
import fg from "fast-glob";

function fail(message: string): never {
  throw new Error(message);
}

async function main(): Promise<void> {
  const draftFiles = await fg("draft/**/*.md", {
    cwd: process.cwd(),
    onlyFiles: true,
  });

  const draftPath = draftFiles[0];
  if (!draftPath) {
    fail("No draft policy file found under draft/** to validate publish manager guard.");
  }

  const result = spawnSync("npm", ["run", "publish:policy", "--", draftPath, "--copy"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
  });

  if (result.status === 0) {
    fail("publish:policy succeeded without --manager; expected manager confirmation guard.");
  }

  const combinedOutput = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (!combinedOutput.includes("Manager confirmation required")) {
    fail(
      "publish:policy failed without --manager, but expected explicit manager confirmation message was missing."
    );
  }

  console.log(
    `Publish manager guard check passed using draft input '${path.posix.normalize(draftPath)}'.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
