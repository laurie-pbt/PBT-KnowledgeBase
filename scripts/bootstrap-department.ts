import fs from "fs/promises";
import path from "path";
import {
  assertValidDepartmentId,
  defaultDisplayNameFromDepartmentId,
  getDepartmentScaffoldDirectories,
  loadDepartmentsConfig,
  writeDepartmentsConfig,
} from "./departments-config";

type CliOptions = {
  departmentId: string;
  displayName?: string;
  managerConfirmed: boolean;
};

function fail(message: string): never {
  throw new Error(message);
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseArgs(argv: string[]): CliOptions {
  let departmentId = "";
  let displayName: string | undefined;
  let managerConfirmed = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--manager") {
      managerConfirmed = true;
      continue;
    }

    if (arg === "--department") {
      const value = argv[index + 1];
      if (!value) {
        fail("Missing value for --department.");
      }
      departmentId = value;
      index += 1;
      continue;
    }

    if (arg === "--display-name") {
      const value = argv[index + 1];
      if (!value) {
        fail("Missing value for --display-name.");
      }
      displayName = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      fail(`Unknown option '${arg}'.`);
    }

    if (departmentId) {
      fail(`Unexpected extra argument '${arg}'.`);
    }

    departmentId = arg;
  }

  if (!departmentId) {
    fail(
      "Missing department id. Use '--department <id>' or provide it as the first positional argument."
    );
  }

  return { departmentId, displayName, managerConfirmed };
}

async function ensureDirectory(relativeDir: string): Promise<void> {
  const absoluteDir = path.join(process.cwd(), relativeDir);
  await fs.mkdir(absoluteDir, { recursive: true });

  const entries = await fs.readdir(absoluteDir);
  if (entries.length === 0) {
    await fs.writeFile(path.join(absoluteDir, ".gitkeep"), "", "utf8");
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.managerConfirmed) {
    fail("Manager confirmation required. Re-run with --manager to bootstrap a new department.");
  }

  const departmentId = assertValidDepartmentId(
    options.departmentId,
    "Invalid new department id"
  );
  const displayName =
    normalizeString(options.displayName) ?? defaultDisplayNameFromDepartmentId(departmentId);

  const config = await loadDepartmentsConfig(process.cwd());
  const existing = config.departments.find((department) => department.id === departmentId);

  if (!existing) {
    config.departments.push({ id: departmentId, display_name: displayName });
    await writeDepartmentsConfig(config, process.cwd());
  }

  const directories = getDepartmentScaffoldDirectories(departmentId);
  for (const relativeDir of directories) {
    await ensureDirectory(relativeDir);
  }

  const action = existing ? "Verified" : "Added";
  console.log(
    `${action} department '${departmentId}' and ensured scaffold directories:\n${directories
      .map((directory) => `- ${directory}`)
      .join("\n")}`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
