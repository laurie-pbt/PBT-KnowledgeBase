import fs from "fs/promises";
import path from "path";
import {
  assertValidDepartmentId,
  getDepartmentScaffoldDirectories,
  loadDepartmentsConfig,
  nowIsoString,
  writeDepartmentsConfig,
} from "./departments-config";

type RetireMode = "archive" | "purge";
type ActorRole = "staff" | "manager" | "admin";

type CliOptions = {
  departmentId: string;
  mode: RetireMode;
  actorRole: ActorRole;
  reason: string;
  requestId?: string;
  managerConfirmed: boolean;
  confirmPhrase?: string;
  clearArchive: boolean;
};

const REQUIRED_CONFIRM_PHRASE = "delete department";

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

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function parseArgs(argv: string[]): CliOptions {
  let departmentId = "";
  let mode: RetireMode | null = null;
  let actorRole: ActorRole | null = null;
  let reason: string | null = null;
  let requestId: string | undefined;
  let managerConfirmed = false;
  let confirmPhrase: string | undefined;
  let clearArchive = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--manager") {
      managerConfirmed = true;
      continue;
    }

    if (arg === "--clear-archive") {
      clearArchive = true;
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

    if (arg === "--mode") {
      const value = argv[index + 1];
      if (!value || (value !== "archive" && value !== "purge")) {
        fail("Invalid --mode. Expected archive|purge.");
      }
      mode = value;
      index += 1;
      continue;
    }

    if (arg === "--actor-role") {
      const value = argv[index + 1];
      if (!value || !["staff", "manager", "admin"].includes(value)) {
        fail("Invalid --actor-role. Expected staff|manager|admin.");
      }
      actorRole = value as ActorRole;
      index += 1;
      continue;
    }

    if (arg === "--reason") {
      const value = argv[index + 1];
      if (!value) {
        fail("Missing value for --reason.");
      }
      reason = value;
      index += 1;
      continue;
    }

    if (arg === "--request-id") {
      const value = argv[index + 1];
      if (!value) {
        fail("Missing value for --request-id.");
      }
      requestId = value;
      index += 1;
      continue;
    }

    if (arg === "--confirm") {
      const value = argv[index + 1];
      if (!value) {
        fail("Missing value for --confirm.");
      }
      confirmPhrase = value;
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
    fail("Missing department id. Use --department <id> or positional arg.");
  }
  if (!mode) {
    fail("Missing --mode (archive|purge).");
  }
  if (!actorRole) {
    fail("Missing --actor-role (staff|manager|admin).");
  }
  if (!reason || !normalizeString(reason)) {
    fail("Missing --reason. A non-empty reason is required.");
  }

  return {
    departmentId,
    mode,
    actorRole,
    reason,
    requestId,
    managerConfirmed,
    confirmPhrase,
    clearArchive,
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function appendLifecycleEvent(event: Record<string, unknown>): Promise<void> {
  const auditDir = path.join(process.cwd(), "audit");
  const auditPath = path.join(auditDir, "department-lifecycle-events.jsonl");
  await fs.mkdir(auditDir, { recursive: true });
  await fs.appendFile(auditPath, `${JSON.stringify(event)}\n`, "utf8");
}

async function archiveDepartmentContent(
  departmentId: string,
  timestamp: string
): Promise<{ moved: string[]; archiveBasePath: string }> {
  const stamp = timestamp.replace(/[:.]/g, "-");
  const archiveBasePath = path.join("archive", "departments", departmentId, stamp);
  const sources = getDepartmentScaffoldDirectories(departmentId);
  const moved: string[] = [];

  for (const sourceRelative of sources) {
    const sourceAbsolute = path.join(process.cwd(), sourceRelative);
    const exists = await pathExists(sourceAbsolute);
    if (!exists) {
      continue;
    }

    const destinationRelative = path.join(archiveBasePath, sourceRelative);
    const destinationAbsolute = path.join(process.cwd(), destinationRelative);
    await fs.mkdir(path.dirname(destinationAbsolute), { recursive: true });
    await fs.rename(sourceAbsolute, destinationAbsolute);
    moved.push(`${normalizePath(sourceRelative)} -> ${normalizePath(destinationRelative)}`);
  }

  return { moved, archiveBasePath: normalizePath(archiveBasePath) };
}

async function purgeDepartmentContent(
  departmentId: string,
  clearArchive: boolean
): Promise<{ removed: string[] }> {
  const removed: string[] = [];

  const roots = [
    ...getDepartmentScaffoldDirectories(departmentId),
    ...(clearArchive ? [path.join("archive", "departments", departmentId)] : []),
  ];

  for (const relativePath of roots) {
    const absolutePath = path.join(process.cwd(), relativePath);
    if (await pathExists(absolutePath)) {
      await fs.rm(absolutePath, { recursive: true, force: true });
      removed.push(normalizePath(relativePath));
    }
  }

  return { removed };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (!options.managerConfirmed) {
    fail("Manager confirmation required. Re-run with --manager.");
  }

  const departmentId = assertValidDepartmentId(
    options.departmentId,
    "Invalid department id"
  );

  if (options.mode === "purge") {
    if (options.actorRole !== "admin") {
      fail("Purge mode is admin-only. Use --actor-role admin.");
    }
    if ((options.confirmPhrase || "").trim().toLowerCase() !== REQUIRED_CONFIRM_PHRASE) {
      fail(
        `Purge mode requires --confirm \"${REQUIRED_CONFIRM_PHRASE}\" exactly.`
      );
    }
  }

  const config = await loadDepartmentsConfig(process.cwd());
  const departmentIndex = config.departments.findIndex(
    (department) => department.id === departmentId
  );
  if (departmentIndex < 0) {
    fail(`Department '${departmentId}' was not found in config/departments.json.`);
  }

  const eventTimestamp = nowIsoString();

  if (options.mode === "archive") {
    const result = await archiveDepartmentContent(departmentId, eventTimestamp);
    const department = config.departments[departmentIndex];
    department.status = "retired";
    department.updated_at = eventTimestamp;
    await writeDepartmentsConfig(config, process.cwd());

    await appendLifecycleEvent({
      event: "department_archived",
      department_id: departmentId,
      actor_role: options.actorRole,
      request_id: normalizeString(options.requestId),
      reason: options.reason,
      mode: "archive",
      archive_path: result.archiveBasePath,
      moved_paths: result.moved,
      timestamp: eventTimestamp,
    });

    console.log(
      `Archived department '${departmentId}' to '${result.archiveBasePath}'.` +
        `\nMoved paths:\n${result.moved.length > 0 ? result.moved.map((item) => `- ${item}`).join("\n") : "- (none found)"}` +
        "\nDepartment status set to retired."
    );
    return;
  }

  const purge = await purgeDepartmentContent(departmentId, options.clearArchive);
  config.departments.splice(departmentIndex, 1);
  await writeDepartmentsConfig(config, process.cwd());

  await appendLifecycleEvent({
    event: "department_purged",
    department_id: departmentId,
    actor_role: options.actorRole,
    request_id: normalizeString(options.requestId),
    reason: options.reason,
    mode: "purge",
    clear_archive: options.clearArchive,
    removed_paths: purge.removed,
    break_glass: true,
    timestamp: eventTimestamp,
  });

  console.log(
    `Purged department '${departmentId}'.` +
      `\nRemoved paths:\n${purge.removed.length > 0 ? purge.removed.map((item) => `- ${item}`).join("\n") : "- (none found)"}` +
      "\nDepartment removed from config/departments.json."
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
