import fs from "fs/promises";
import path from "path";
import {
  DepartmentStatus,
  assertValidDepartmentId,
  loadDepartmentsConfig,
  nowIsoString,
  writeDepartmentsConfig,
} from "./departments-config";

type CliOptions = {
  departmentId: string;
  displayName?: string;
  status?: DepartmentStatus;
  actorRole?: "staff" | "manager" | "admin";
  requestId?: string;
  reason?: string;
  managerConfirmed: boolean;
};

const VALID_STATUS: DepartmentStatus[] = ["active", "deprecated", "retired"];
const VALID_ACTOR_ROLES = ["staff", "manager", "admin"] as const;

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
  let status: DepartmentStatus | undefined;
  let actorRole: "staff" | "manager" | "admin" | undefined;
  let requestId: string | undefined;
  let reason: string | undefined;
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

    if (arg === "--status") {
      const value = argv[index + 1];
      if (!value) {
        fail("Missing value for --status.");
      }
      if (!VALID_STATUS.includes(value as DepartmentStatus)) {
        fail(`Invalid --status '${value}'. Expected one of: ${VALID_STATUS.join(", ")}.`);
      }
      status = value as DepartmentStatus;
      index += 1;
      continue;
    }

    if (arg === "--actor-role") {
      const value = argv[index + 1];
      if (!value) {
        fail("Missing value for --actor-role.");
      }
      if (!VALID_ACTOR_ROLES.includes(value as (typeof VALID_ACTOR_ROLES)[number])) {
        fail(`Invalid --actor-role '${value}'. Expected one of: ${VALID_ACTOR_ROLES.join(", ")}.`);
      }
      actorRole = value as (typeof VALID_ACTOR_ROLES)[number];
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

    if (arg === "--reason") {
      const value = argv[index + 1];
      if (!value) {
        fail("Missing value for --reason.");
      }
      reason = value;
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

  if (!displayName && !status) {
    fail("No update requested. Provide at least one of --display-name or --status.");
  }

  return {
    departmentId,
    displayName,
    status,
    actorRole,
    requestId,
    reason,
    managerConfirmed,
  };
}

async function appendLifecycleEvent(event: Record<string, unknown>): Promise<void> {
  const auditDir = path.join(process.cwd(), "audit");
  const auditPath = path.join(auditDir, "department-lifecycle-events.jsonl");
  await fs.mkdir(auditDir, { recursive: true });
  await fs.appendFile(auditPath, `${JSON.stringify(event)}\n`, "utf8");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (!options.managerConfirmed) {
    fail("Manager confirmation required. Re-run with --manager to update department metadata.");
  }

  const departmentId = assertValidDepartmentId(
    options.departmentId,
    "Invalid department id"
  );

  const config = await loadDepartmentsConfig(process.cwd());
  const department = config.departments.find((entry) => entry.id === departmentId);
  if (!department) {
    fail(`Department '${departmentId}' was not found in config/departments.json.`);
  }

  const changes: string[] = [];
  const displayName = normalizeString(options.displayName);
  if (displayName && displayName !== department.display_name) {
    department.display_name = displayName;
    changes.push(`display_name='${displayName}'`);
  }

  if (options.status && options.status !== department.status) {
    department.status = options.status;
    changes.push(`status='${options.status}'`);
  }

  if (changes.length === 0) {
    console.log(`No changes applied for department '${departmentId}'.`);
    return;
  }

  department.updated_at = nowIsoString();
  await writeDepartmentsConfig(config, process.cwd());

  const eventTimestamp = nowIsoString();
  await appendLifecycleEvent({
    event: "department_updated",
    department_id: departmentId,
    actor_role: options.actorRole ?? null,
    request_id: normalizeString(options.requestId),
    reason: normalizeString(options.reason),
    changes,
    timestamp: eventTimestamp,
  });

  console.log(
    `Updated department '${departmentId}' (${changes.join(", ")}).` +
      `\nRecorded lifecycle event at audit/department-lifecycle-events.jsonl.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
