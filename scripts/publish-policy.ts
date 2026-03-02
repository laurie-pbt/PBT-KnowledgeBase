import fs from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import { spawnSync } from "child_process";
import matter from "gray-matter";
import fg from "fast-glob";

const BASE_REQUIRED_FIELDS = [
  "policy_id",
  "title",
  "priority",
  "owner_team",
  "approvers",
  "jurisdiction",
  "applies_to",
  "tags",
] as const;

const VALID_DOMAINS = ["merchandise", "workshops", "online-training"] as const;
const VALID_VISIBILITY = ["public", "internal"] as const;

type BaseRequiredField = (typeof BASE_REQUIRED_FIELDS)[number];
type Domain = (typeof VALID_DOMAINS)[number];
type Visibility = (typeof VALID_VISIBILITY)[number];
type LiveType = "perpetual" | "temporary";

type CliOptions = {
  sourceInput: string;
  visibility?: Visibility;
  effectiveFrom?: string;
  effectiveTo?: string;
  copy: boolean;
  managerConfirmed: boolean;
};

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function usage(): string {
  return [
    "Usage:",
    "  ts-node scripts/publish-policy.ts --manager <draft-path-or-policy_id> [options]",
    "",
    "Options:",
    "  --manager                 Required confirmation for manager-only publish workflow.",
    "  --copy                    Copy draft into live instead of moving it.",
    "  --visibility <value>      Override visibility (public|internal).",
    "  --effective-from <date>   Override effective_from (YYYY-MM-DD).",
    "  --effective-to <date>     Override effective_to (YYYY-MM-DD). When set, policy is published to live/temporary/**.",
    "  --help                    Show this message.",
  ].join("\n");
}

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

function parseIsoDate(
  value: unknown,
  fieldName: string,
  filePath: string
): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  const raw = String(value).trim();
  if (raw === "") {
    return null;
  }

  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    fail(`Invalid frontmatter field '${fieldName}' in ${filePath}: '${raw}'. Expected YYYY-MM-DD.`);
  }

  return date;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseArgs(argv: string[]): CliOptions {
  let sourceInput = "";
  let visibility: Visibility | undefined;
  let effectiveFrom: string | undefined;
  let effectiveTo: string | undefined;
  let copy = false;
  let managerConfirmed = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }

    if (arg === "--manager") {
      managerConfirmed = true;
      continue;
    }

    if (arg === "--copy") {
      copy = true;
      continue;
    }

    if (arg === "--visibility") {
      const value = argv[index + 1];
      if (!value) {
        fail("Missing value for --visibility.");
      }
      if (!VALID_VISIBILITY.includes(value as Visibility)) {
        fail(`Invalid --visibility '${value}'. Expected one of: ${VALID_VISIBILITY.join(", ")}.`);
      }
      visibility = value as Visibility;
      index += 1;
      continue;
    }

    if (arg === "--effective-from") {
      const value = argv[index + 1];
      if (!value) {
        fail("Missing value for --effective-from.");
      }
      effectiveFrom = value;
      index += 1;
      continue;
    }

    if (arg === "--effective-to") {
      const value = argv[index + 1];
      if (!value) {
        fail("Missing value for --effective-to.");
      }
      effectiveTo = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      fail(`Unknown option '${arg}'.`);
    }

    if (sourceInput) {
      fail(`Unexpected extra argument '${arg}'.`);
    }
    sourceInput = arg;
  }

  if (!sourceInput) {
    fail(`Missing draft policy path or policy_id.\n\n${usage()}`);
  }

  return {
    sourceInput,
    visibility,
    effectiveFrom,
    effectiveTo,
    copy,
    managerConfirmed,
  };
}

function assertRequiredFields(
  data: Record<string, unknown>,
  filePath: string,
  requiredFields: readonly BaseRequiredField[]
): void {
  const missing = requiredFields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(data, field)
  );
  if (missing.length > 0) {
    fail(
      `Missing required frontmatter fields in ${filePath}: ${missing.join(", ")}`
    );
  }

  const requiredStrings: BaseRequiredField[] = ["policy_id", "title", "owner_team"];
  for (const field of requiredStrings) {
    const value = data[field];
    if (typeof value !== "string" || value.trim() === "") {
      fail(`Frontmatter field '${field}' is empty in ${filePath}.`);
    }
  }
}

function isDraftPath(relativePath: string): boolean {
  return relativePath.startsWith("draft/") && relativePath.endsWith(".md");
}

function validateDomain(value: string, filePath: string): Domain {
  if (!VALID_DOMAINS.includes(value as Domain)) {
    fail(
      `Invalid frontmatter field 'domain' in ${filePath}: '${value}'. Expected one of ${VALID_DOMAINS.join(
        ", "
      )}.`
    );
  }
  return value as Domain;
}

async function resolveDraftFile(sourceInput: string): Promise<string> {
  const asPath = path.isAbsolute(sourceInput)
    ? sourceInput
    : path.resolve(process.cwd(), sourceInput);

  if (existsSync(asPath)) {
    const relativePath = normalizePath(path.relative(process.cwd(), asPath));
    if (!isDraftPath(relativePath)) {
      fail(
        `Input path must be a markdown file under draft/**: ${relativePath}`
      );
    }
    return asPath;
  }

  const draftFiles = await fg("draft/**/*.md", {
    cwd: process.cwd(),
    absolute: true,
    onlyFiles: true,
  });

  const matches: string[] = [];
  for (const filePath of draftFiles) {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = matter(raw);
    if (String(parsed.data.policy_id ?? "").trim() === sourceInput) {
      matches.push(filePath);
    }
  }

  if (matches.length === 0) {
    fail(
      `No draft policy matched '${sourceInput}'. Provide a draft path or a policy_id found under draft/**.`
    );
  }
  if (matches.length > 1) {
    const list = matches
      .map((filePath) => normalizePath(path.relative(process.cwd(), filePath)))
      .join(", ");
    fail(`policy_id '${sourceInput}' is not unique in draft/**. Matches: ${list}`);
  }

  return matches[0];
}

function detectPackageManager(): { command: string; args: string[] } {
  if (existsSync(path.join(process.cwd(), "package-lock.json"))) {
    return { command: "npm", args: ["run", "build:exports"] };
  }
  if (existsSync(path.join(process.cwd(), "pnpm-lock.yaml"))) {
    return { command: "pnpm", args: ["run", "build:exports"] };
  }
  if (existsSync(path.join(process.cwd(), "yarn.lock"))) {
    return { command: "yarn", args: ["run", "build:exports"] };
  }
  return { command: "npm", args: ["run", "build:exports"] };
}

async function assertLivePolicyIdIsUnique(
  policyId: string,
  sourcePath: string
): Promise<void> {
  const liveFiles = await fg("live/**/*.md", {
    cwd: process.cwd(),
    absolute: true,
    onlyFiles: true,
  });

  for (const filePath of liveFiles) {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = matter(raw);
    const livePolicyId = String(parsed.data.policy_id ?? "").trim();
    if (livePolicyId === policyId) {
      const conflictPath = normalizePath(path.relative(process.cwd(), filePath));
      const sourceRelativePath = normalizePath(path.relative(process.cwd(), sourcePath));
      fail(
        `Duplicate frontmatter field 'policy_id' '${policyId}': ${conflictPath} already exists, cannot publish ${sourceRelativePath}.`
      );
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (!options.managerConfirmed) {
    fail(
      "Manager confirmation required. Re-run with --manager to publish draft content to live."
    );
  }

  const sourcePath = await resolveDraftFile(options.sourceInput);
  const sourceRelativePath = normalizePath(path.relative(process.cwd(), sourcePath));
  const sourceRaw = await fs.readFile(sourcePath, "utf8");
  const parsed = matter(sourceRaw);
  const data = parsed.data as Record<string, unknown>;

  assertRequiredFields(data, sourceRelativePath, BASE_REQUIRED_FIELDS);

  const pathSegments = sourceRelativePath.split("/");
  if (pathSegments.length < 4) {
    fail(
      `Draft policy path must include stage/domain/file segments: ${sourceRelativePath}`
    );
  }
  const domainFromPath = validateDomain(pathSegments[2], sourceRelativePath);

  const policyId = normalizeString(data.policy_id);
  if (!policyId) {
    fail(`Frontmatter field 'policy_id' is empty in ${sourceRelativePath}.`);
  }

  const resolvedDomainValue = normalizeString(data.domain) ?? domainFromPath;
  const resolvedDomain = validateDomain(resolvedDomainValue, sourceRelativePath);
  if (resolvedDomain !== domainFromPath) {
    fail(
      `Frontmatter field 'domain' in ${sourceRelativePath} must match folder domain '${domainFromPath}'.`
    );
  }

  const resolvedVisibility =
    options.visibility ?? (normalizeString(data.visibility) as Visibility | null);
  if (!resolvedVisibility) {
    fail(`Missing frontmatter field 'visibility' in ${sourceRelativePath}.`);
  }
  if (!VALID_VISIBILITY.includes(resolvedVisibility)) {
    fail(
      `Invalid frontmatter field 'visibility' in ${sourceRelativePath}: '${resolvedVisibility}'. Expected one of ${VALID_VISIBILITY.join(
        ", "
      )}.`
    );
  }

  const effectiveFrom = parseIsoDate(
    options.effectiveFrom ?? data.effective_from,
    "effective_from",
    sourceRelativePath
  );
  if (!effectiveFrom) {
    fail(`Missing frontmatter field 'effective_from' in ${sourceRelativePath}.`);
  }

  const effectiveTo = parseIsoDate(
    options.effectiveTo ?? data.effective_to,
    "effective_to",
    sourceRelativePath
  );
  if (effectiveTo && effectiveTo.getTime() < effectiveFrom.getTime()) {
    fail(
      `Frontmatter field 'effective_to' in ${sourceRelativePath} must be on or after effective_from.`
    );
  }

  await assertLivePolicyIdIsUnique(policyId, sourcePath);

  const liveType: LiveType = effectiveTo ? "temporary" : "perpetual";
  const destinationRelativePath = normalizePath(
    path.join("live", liveType, resolvedDomain, path.basename(sourcePath))
  );
  const destinationPath = path.join(process.cwd(), destinationRelativePath);

  if (existsSync(destinationPath)) {
    fail(`Destination file already exists: ${destinationRelativePath}`);
  }

  const updatedData: Record<string, unknown> = {
    ...data,
    policy_id: policyId,
    status: "active",
    type: liveType,
    domain: resolvedDomain,
    visibility: resolvedVisibility,
    effective_from: formatDate(effectiveFrom),
    effective_to: effectiveTo ? formatDate(effectiveTo) : null,
  };

  const updatedMarkdown = matter.stringify(parsed.content, updatedData);

  let destinationCreated = false;
  let sourceRemoved = false;

  try {
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.writeFile(destinationPath, updatedMarkdown, "utf8");
    destinationCreated = true;

    if (!options.copy) {
      await fs.unlink(sourcePath);
      sourceRemoved = true;
    }

    const packageManager = detectPackageManager();
    const result = spawnSync(packageManager.command, packageManager.args, {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    });

    if (result.status !== 0) {
      fail(
        `build:exports failed after publishing ${sourceRelativePath}. Publish has been rolled back.`
      );
    }
  } catch (error) {
    if (destinationCreated && existsSync(destinationPath)) {
      await fs.rm(destinationPath, { force: true });
    }
    if (sourceRemoved && !existsSync(sourcePath)) {
      await fs.writeFile(sourcePath, sourceRaw, "utf8");
    }
    throw error;
  }

  const action = options.copy ? "Copied" : "Moved";
  console.log(
    `${action} ${sourceRelativePath} -> ${destinationRelativePath}\n` +
      `Policy '${policyId}' published as ${liveType} with visibility '${resolvedVisibility}'.\n` +
      "build:exports completed successfully."
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
