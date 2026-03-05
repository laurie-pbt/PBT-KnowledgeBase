import fs from "fs/promises";
import path from "path";

export type DepartmentEntry = {
  id: string;
  display_name: string;
  status: DepartmentStatus;
  updated_at: string;
};

export type DepartmentStatus = "active" | "deprecated" | "retired";

export type DepartmentsConfig = {
  version: number;
  departments: DepartmentEntry[];
};

const DEPARTMENT_ID_PATTERN = /^[a-z0-9-]+$/;

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

export function assertValidDepartmentId(value: unknown, context: string): string {
  const id = normalizeString(value);
  if (!id) {
    fail(`${context} must be a non-empty string.`);
  }

  if (!DEPARTMENT_ID_PATTERN.test(id)) {
    fail(`${context} '${id}' is invalid. Expected lowercase kebab-case ([a-z0-9-]+).`);
  }

  return id;
}

function assertValidDisplayName(value: unknown, context: string): string {
  const displayName = normalizeString(value);
  if (!displayName) {
    fail(`${context} must be a non-empty string.`);
  }
  return displayName;
}

function assertValidIsoDateTime(value: unknown, context: string): string {
  const dateTime = normalizeString(value);
  if (!dateTime) {
    fail(`${context} must be a non-empty ISO-8601 string.`);
  }
  if (!dateTime.includes("T") || Number.isNaN(Date.parse(dateTime))) {
    fail(`${context} '${dateTime}' is not a valid ISO-8601 datetime.`);
  }
  return dateTime;
}

function assertValidDepartmentStatus(value: unknown, context: string): DepartmentStatus {
  const status = normalizeString(value);
  if (!status) {
    fail(`${context} must be provided.`);
  }
  if (!["active", "deprecated", "retired"].includes(status)) {
    fail(`${context} '${status}' is invalid. Expected active|deprecated|retired.`);
  }
  return status as DepartmentStatus;
}

export function getDepartmentsConfigPath(rootDir: string = process.cwd()): string {
  return path.join(rootDir, "config", "departments.json");
}

export async function loadDepartmentsConfig(
  rootDir: string = process.cwd()
): Promise<DepartmentsConfig> {
  const configPath = getDepartmentsConfigPath(rootDir);
  const raw = await fs.readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const version = parsed.version;
  if (version !== 2) {
    fail(
      `Invalid departments config version in ${configPath}. Expected version=2, received '${String(
        version
      )}'.`
    );
  }

  const departmentsRaw = parsed.departments;
  if (!Array.isArray(departmentsRaw)) {
    fail(`Invalid departments config in ${configPath}: 'departments' must be an array.`);
  }

  const departments: DepartmentEntry[] = [];
  const seenIds = new Set<string>();

  for (let index = 0; index < departmentsRaw.length; index += 1) {
    const row = departmentsRaw[index];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      fail(`Invalid departments config entry at index ${index}: expected object.`);
    }

    const entry = row as Record<string, unknown>;
    const id = assertValidDepartmentId(
      entry.id,
      `Invalid departments config entry at index ${index} field 'id'`
    );
    const displayName = assertValidDisplayName(
      entry.display_name,
      `Invalid departments config entry '${id}' field 'display_name'`
    );
    const status = assertValidDepartmentStatus(
      entry.status,
      `Invalid departments config entry '${id}' field 'status'`
    );
    const updatedAt = assertValidIsoDateTime(
      entry.updated_at,
      `Invalid departments config entry '${id}' field 'updated_at'`
    );

    if (seenIds.has(id)) {
      fail(`Duplicate department id '${id}' in ${configPath}.`);
    }

    seenIds.add(id);
    departments.push({
      id,
      display_name: displayName,
      status,
      updated_at: updatedAt,
    });
  }

  return {
    version: 2,
    departments,
  };
}

export async function loadDepartmentIds(
  rootDir: string = process.cwd(),
  statuses?: DepartmentStatus[]
): Promise<string[]> {
  const config = await loadDepartmentsConfig(rootDir);
  const statusFilter = statuses ? new Set(statuses) : null;
  return config.departments
    .filter((department) =>
      statusFilter ? statusFilter.has(department.status) : true
    )
    .map((department) => department.id);
}

export async function loadActiveDepartmentIds(
  rootDir: string = process.cwd()
): Promise<string[]> {
  return loadDepartmentIds(rootDir, ["active"]);
}

export async function writeDepartmentsConfig(
  config: DepartmentsConfig,
  rootDir: string = process.cwd()
): Promise<void> {
  const configPath = getDepartmentsConfigPath(rootDir);
  await fs.mkdir(path.dirname(configPath), { recursive: true });

  const normalized: DepartmentsConfig = {
    version: 2,
    departments: [...config.departments].sort((a, b) => a.id.localeCompare(b.id)),
  };

  await fs.writeFile(configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export function getDepartmentScaffoldDirectories(departmentId: string): string[] {
  return [
    path.join("live", "perpetual", departmentId),
    path.join("live", "temporary", departmentId),
    path.join("draft", "in-progress", departmentId),
    path.join("draft", "experiments", departmentId),
  ];
}

export function defaultDisplayNameFromDepartmentId(departmentId: string): string {
  return departmentId
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function nowIsoString(): string {
  return new Date().toISOString();
}
