import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import {
  DepartmentsConfig,
  getDepartmentScaffoldDirectories,
  loadDepartmentsConfig,
} from "./departments-config";

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    fail(message);
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getTsNodeBin(repoRoot: string): string {
  return path.join(repoRoot, "node_modules", "ts-node", "dist", "bin.js");
}

function runTsScript(
  repoRoot: string,
  scriptName: string,
  args: string[],
  cwd: string
): { status: number | null; stdout: string; stderr: string } {
  const tsNodeBin = getTsNodeBin(repoRoot);
  const scriptPath = path.join(repoRoot, "scripts", scriptName);

  const result = spawnSync(process.execPath, [tsNodeBin, scriptPath, ...args], {
    cwd,
    encoding: "utf8",
    env: process.env,
  });

  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function seedWorkspace(
  tempRoot: string,
  config: DepartmentsConfig,
  withPolicyMarkdown: boolean = false
): Promise<void> {
  await writeJson(path.join(tempRoot, "config", "departments.json"), config);

  for (const department of config.departments) {
    const dirs = getDepartmentScaffoldDirectories(department.id);
    for (const relativeDir of dirs) {
      await fs.mkdir(path.join(tempRoot, relativeDir), { recursive: true });
    }
  }

  if (withPolicyMarkdown) {
    const policyPath = path.join(
      tempRoot,
      "draft",
      "in-progress",
      config.departments[0].id,
      "TEMP-001_test-policy.md"
    );
    const content = `---\npolicy_id: TEMP-001\ntitle: \"Temp policy\"\npriority: 1\nowner_team: \"Policy Ops\"\napprovers:\n  - \"Head of Support\"\njurisdiction:\n  - \"Global\"\napplies_to:\n  - \"Support agents\"\ntags:\n  - \"temp\"\ndomain: ${config.departments[0].id}\nvisibility: public\neffective_from: 2026-01-01\n---\n\n# Summary\nTemp\n`;
    await fs.writeFile(policyPath, content, "utf8");
  }
}

async function checkActiveDepartmentDirectories(): Promise<void> {
  const root = process.cwd();
  const config = await loadDepartmentsConfig(root);

  for (const department of config.departments) {
    if (department.status !== "active") {
      continue;
    }

    const dirs = getDepartmentScaffoldDirectories(department.id);
    for (const relativeDir of dirs) {
      const absolute = path.join(root, relativeDir);
      const isPresent = await exists(absolute);
      assert(
        isPresent,
        `Active department '${department.id}' is missing required directory '${relativeDir}'.`
      );
    }
  }
}

async function checkArchiveWorks(repoRoot: string): Promise<void> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kb-archive-check-"));
  try {
    const config: DepartmentsConfig = {
      version: 2,
      departments: [
        {
          id: "content",
          display_name: "Content",
          status: "active",
          updated_at: "2026-03-05T00:00:00.000Z",
        },
      ],
    };

    await seedWorkspace(tempRoot, config);

    const sourceFile = path.join(
      tempRoot,
      "live",
      "perpetual",
      "content",
      "POL-001.md"
    );
    await fs.writeFile(sourceFile, "# Policy\n", "utf8");

    const result = runTsScript(
      repoRoot,
      "department-retire.ts",
      [
        "--manager",
        "--department",
        "content",
        "--mode",
        "archive",
        "--actor-role",
        "manager",
        "--reason",
        "test archive",
      ],
      tempRoot
    );

    assert(result.status === 0, `Archive command failed: ${result.stderr || result.stdout}`);

    const archivedDir = path.join(tempRoot, "archive", "departments", "content");
    assert(await exists(archivedDir), "Archive directory for content was not created.");

    const activeDir = path.join(tempRoot, "live", "perpetual", "content");
    assert(!(await exists(activeDir)), "Active source directory should be moved away during archive.");

    const postConfigRaw = await fs.readFile(path.join(tempRoot, "config", "departments.json"), "utf8");
    const postConfig = JSON.parse(postConfigRaw) as DepartmentsConfig;
    assert(
      postConfig.departments[0]?.status === "retired",
      "Archive mode should set department status=retired."
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function checkPurgeGuards(repoRoot: string): Promise<void> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kb-purge-guard-check-"));
  try {
    const config: DepartmentsConfig = {
      version: 2,
      departments: [
        {
          id: "content",
          display_name: "Content",
          status: "active",
          updated_at: "2026-03-05T00:00:00.000Z",
        },
      ],
    };
    await seedWorkspace(tempRoot, config);

    const asManager = runTsScript(
      repoRoot,
      "department-retire.ts",
      [
        "--manager",
        "--department",
        "content",
        "--mode",
        "purge",
        "--actor-role",
        "manager",
        "--reason",
        "test purge role guard",
        "--confirm",
        "delete department",
      ],
      tempRoot
    );

    assert(asManager.status !== 0, "Purge must fail for non-admin actor-role.");
    assert(
      `${asManager.stdout}\n${asManager.stderr}`.includes("admin-only"),
      "Purge non-admin failure should mention admin-only requirement."
    );

    const missingConfirm = runTsScript(
      repoRoot,
      "department-retire.ts",
      [
        "--manager",
        "--department",
        "content",
        "--mode",
        "purge",
        "--actor-role",
        "admin",
        "--reason",
        "test purge confirm guard",
        "--confirm",
        "wrong phrase",
      ],
      tempRoot
    );

    assert(missingConfirm.status !== 0, "Purge must fail without exact confirm phrase.");
    assert(
      `${missingConfirm.stdout}\n${missingConfirm.stderr}`.includes("requires --confirm"),
      "Purge confirm failure should mention required confirm phrase."
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function checkPublishBlockedForNonActive(repoRoot: string): Promise<void> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kb-publish-block-check-"));
  try {
    const config: DepartmentsConfig = {
      version: 2,
      departments: [
        {
          id: "content",
          display_name: "Content",
          status: "deprecated",
          updated_at: "2026-03-05T00:00:00.000Z",
        },
      ],
    };

    await seedWorkspace(tempRoot, config, true);

    const result = runTsScript(
      repoRoot,
      "publish-policy.ts",
      [
        "--manager",
        path.join("draft", "in-progress", "content", "TEMP-001_test-policy.md"),
        "--copy",
      ],
      tempRoot
    );

    assert(result.status !== 0, "Publish should fail for non-active department.");
    assert(
      `${result.stdout}\n${result.stderr}`.includes("Invalid frontmatter field 'domain'"),
      "Publish failure for non-active department should explain domain is not allowed for publish."
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();

  await checkActiveDepartmentDirectories();
  await checkArchiveWorks(repoRoot);
  await checkPurgeGuards(repoRoot);
  await checkPublishBlockedForNonActive(repoRoot);

  console.log(
    "Department lifecycle check passed: active directories valid, archive verified, purge guards verified, non-active publish blocked."
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
