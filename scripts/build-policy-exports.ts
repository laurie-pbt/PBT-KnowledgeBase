import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
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
type LivePolicyType = "perpetual" | "temporary";
type PolicyRoot = "live" | "draft";

type PolicySection = {
  section_id: string;
  heading: string;
  content: string;
};

type PolicyRecord = {
  policy_id: unknown;
  title: unknown;
  status: unknown;
  type: unknown;
  domain: Domain;
  visibility: string | null;
  category_path: string;
  effective_from: string | null;
  effective_to: string | null;
  priority: unknown;
  owner_team: unknown;
  approvers: unknown;
  jurisdiction: unknown;
  applies_to: unknown;
  tags: unknown;
  path: string;
  sections: PolicySection[];
  raw_markdown: string;
};

type ExportPayload = {
  version: 2;
  generated_at: string;
  source: "live" | "draft";
  policies: PolicyRecord[];
};

type IndexPayload = {
  version: 2;
  generated_at: string;
  policies: Array<{
    policy_id: unknown;
    title: unknown;
    status: unknown;
    type: unknown;
    effective_from: string | null;
    effective_to: string | null;
    visibility: string | null;
    section_ids: string[];
    tags: unknown;
    path: string;
  }>;
};

type ExportMetadataPayload = {
  version: 1;
  contract: "alice-publisher-v1";
  export_schema_version: 2;
  generated_at: string;
  artifacts: {
    policies: string;
    policies_draft: string;
    index: string;
  };
  publish: {
    source_system: string | null;
    actor_id: string | null;
    request_id: string | null;
    pr_number: number | null;
    merge_commit: string | null;
  };
};

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
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
    throw new Error(
      `Missing required frontmatter fields in ${filePath}: ${missing.join(", ")}`
    );
  }

  const requiredStrings: BaseRequiredField[] = ["policy_id", "title", "owner_team"];

  for (const field of requiredStrings) {
    const value = data[field];
    if (typeof value === "string" && value.trim() === "") {
      throw new Error(`Frontmatter field '${field}' is empty in ${filePath}`);
    }
  }
}

type PathContext = {
  root: PolicyRoot;
  statusFromPath: "live" | "draft";
  typeFromPath?: LivePolicyType;
  domainFromPath: Domain;
  categoryPath: string;
};

function parsePathContext(relativePath: string): PathContext {
  const segments = relativePath.split("/");
  if (segments.length < 4) {
    throw new Error(
      `Policy path must include a category folder (live/<type>/<domain>/file.md) or (draft/<stage>/<domain>/file.md): ${relativePath}`
    );
  }

  const root = segments[0];
  if (root !== "live" && root !== "draft") {
    throw new Error(`Policy path must start with live/ or draft/: ${relativePath}`);
  }

  const statusFromPath = root === "live" ? "live" : "draft";
  const categoryPath = segments.slice(0, 3).join("/");
  const domainSegment = segments[2];
  const domainFromPath = validateDomain(domainSegment, relativePath);
  const context: PathContext = {
    root,
    statusFromPath,
    domainFromPath,
    categoryPath,
  };

  if (root === "live") {
    const typeSegment = segments[1];
    if (typeSegment !== "perpetual" && typeSegment !== "temporary") {
      throw new Error(
        `Live policy path must be under live/perpetual or live/temporary: ${relativePath}`
      );
    }
    context.typeFromPath = typeSegment;
  }

  return context;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function validateDomain(value: string, filePath: string): Domain {
  if (!VALID_DOMAINS.includes(value as Domain)) {
    throw new Error(
      `Invalid domain '${value}' in ${filePath}. Expected one of ${VALID_DOMAINS.join(
        ", "
      )}.`
    );
  }
  return value as Domain;
}

function resolveStatus(data: Record<string, unknown>, context: PathContext): string {
  return normalizeString(data.status) ?? context.statusFromPath;
}

function resolveType(
  data: Record<string, unknown>,
  context: PathContext,
  filePath: string
): string {
  const rawType = normalizeString(data.type);

  if (context.root === "live") {
    if (rawType) {
      if (context.typeFromPath && rawType !== context.typeFromPath) {
        throw new Error(
          `Type mismatch in ${filePath}: frontmatter '${rawType}' does not match folder '${context.typeFromPath}'.`
        );
      }
      return rawType;
    }

    if (!context.typeFromPath) {
      throw new Error(`Unable to infer type from path for ${filePath}.`);
    }

    return context.typeFromPath;
  }

  if (rawType) {
    return rawType;
  }

  throw new Error(`Missing frontmatter field 'type' in ${filePath}.`);
}

function resolveDomain(
  data: Record<string, unknown>,
  context: PathContext,
  filePath: string
): Domain {
  const rawDomain = normalizeString(data.domain);
  if (rawDomain) {
    const validated = validateDomain(rawDomain, filePath);
    if (validated !== context.domainFromPath) {
      throw new Error(
        `Domain mismatch in ${filePath}: frontmatter '${validated}' does not match folder '${context.domainFromPath}'.`
      );
    }
    return validated;
  }

  return context.domainFromPath;
}

function resolveVisibility(
  data: Record<string, unknown>,
  context: PathContext,
  filePath: string
): string | null {
  const rawVisibility = normalizeString(data.visibility);

  if (context.root === "live") {
    if (!rawVisibility) {
      throw new Error(`Missing frontmatter field 'visibility' in ${filePath}.`);
    }
    if (!VALID_VISIBILITY.includes(rawVisibility as Visibility)) {
      throw new Error(
        `Invalid frontmatter field 'visibility' in ${filePath}: '${rawVisibility}'. Expected one of ${VALID_VISIBILITY.join(
          ", "
        )}.`
      );
    }
  }

  return rawVisibility;
}

function parseIsoDate(
  value: unknown,
  fieldName: string,
  filePath: string
): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
    );
  }

  const raw = String(value).trim();
  if (raw === "") {
    return null;
  }

  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(
      `Invalid ${fieldName} date '${raw}' in ${filePath}. Expected YYYY-MM-DD.`
    );
  }

  return date;
}

function getTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isActivePolicy(start: Date, end: Date | null): boolean {
  const today = getTodayUtc();

  if (start.getTime() > today.getTime()) {
    return false;
  }

  if (end && today.getTime() > end.getTime()) {
    return false;
  }

  return true;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function resolveEffectiveDates(
  data: Record<string, unknown>,
  filePath: string,
  requireFrom: boolean
): {
  effectiveFromDate: Date | null;
  effectiveToDate: Date | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
} {
  const effectiveFromDate = parseIsoDate(
    data.effective_from,
    "effective_from",
    filePath
  );
  const effectiveToDate = parseIsoDate(data.effective_to, "effective_to", filePath);

  if (requireFrom && !effectiveFromDate) {
    throw new Error(`effective_from is required in ${filePath}`);
  }

  return {
    effectiveFromDate,
    effectiveToDate,
    effectiveFrom: effectiveFromDate ? formatDate(effectiveFromDate) : null,
    effectiveTo: effectiveToDate ? formatDate(effectiveToDate) : null,
  };
}

function normalizeHeadingText(heading: string): string {
  return heading.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildSectionId(policyId: string, heading: string): string {
  const normalizedHeading = normalizeHeadingText(heading);
  return crypto
    .createHash("sha256")
    .update(`${policyId}||${normalizedHeading}`)
    .digest("hex");
}

function extractSections(markdown: string, policyId: string): PolicySection[] {
  const lines = markdown.split(/\r?\n/);
  const sectionsByHeading: Record<string, string> = {};
  let currentHeading: string | null = null;
  let buffer: string[] = [];
  let inCodeBlock = false;

  const flush = () => {
    if (!currentHeading) {
      return;
    }

    const content = buffer.join("\n").trim();
    if (Object.prototype.hasOwnProperty.call(sectionsByHeading, currentHeading)) {
      if (content) {
        sectionsByHeading[currentHeading] = [sectionsByHeading[currentHeading], content]
          .filter(Boolean)
          .join("\n\n")
          .trim();
      }
    } else {
      sectionsByHeading[currentHeading] = content;
    }
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      if (currentHeading) {
        buffer.push(line);
      }
      continue;
    }

    if (!inCodeBlock) {
      const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
      if (headingMatch) {
        flush();
        currentHeading = headingMatch[2];
        buffer = [];
        continue;
      }
    }

    if (currentHeading) {
      buffer.push(line);
    }
  }

  flush();
  return Object.entries(sectionsByHeading).map(([heading, content]) => ({
    section_id: buildSectionId(policyId, heading),
    heading,
    content,
  }));
}

function buildPolicyRecord(
  filePath: string,
  rawMarkdown: string,
  data: Record<string, unknown>,
  content: string,
  resolvedStatus: string,
  resolvedType: string,
  resolvedDomain: Domain,
  resolvedVisibility: string | null,
  categoryPath: string,
  effectiveFrom: string | null,
  effectiveTo: string | null
): PolicyRecord {
  const relativePath = normalizePath(path.relative(process.cwd(), filePath));
  const policyId = String(data.policy_id ?? "");
  const sections = extractSections(content, policyId);

  return {
    policy_id: data.policy_id,
    title: data.title,
    status: resolvedStatus,
    type: resolvedType,
    domain: resolvedDomain,
    visibility: resolvedVisibility,
    category_path: categoryPath,
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    priority: data.priority,
    owner_team: data.owner_team,
    approvers: data.approvers,
    jurisdiction: data.jurisdiction,
    applies_to: data.applies_to,
    tags: data.tags,
    path: relativePath,
    sections,
    raw_markdown: rawMarkdown,
  };
}

async function loadPolicies(
  pattern: string,
  source: "live" | "draft",
  filterByDate: boolean
): Promise<ExportPayload> {
  const files = await fg(pattern, {
    cwd: process.cwd(),
    onlyFiles: true,
    absolute: true,
  });

  files.sort();

  const policies: PolicyRecord[] = [];

  for (const filePath of files) {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;

    const relativePath = normalizePath(path.relative(process.cwd(), filePath));
    const context = parsePathContext(relativePath);

    assertRequiredFields(data, relativePath, BASE_REQUIRED_FIELDS);

    const resolvedStatus = resolveStatus(data, context);
    const resolvedType = resolveType(data, context, relativePath);
    const resolvedDomain = resolveDomain(data, context, relativePath);
    const resolvedVisibility = resolveVisibility(data, context, relativePath);
    const {
      effectiveFromDate,
      effectiveToDate,
      effectiveFrom,
      effectiveTo,
    } = resolveEffectiveDates(data, relativePath, source === "live");

    if (
      filterByDate &&
      effectiveFromDate &&
      !isActivePolicy(effectiveFromDate, effectiveToDate)
    ) {
      continue;
    }

    policies.push(
      buildPolicyRecord(
        filePath,
        raw,
        data,
        parsed.content,
        resolvedStatus,
        resolvedType,
        resolvedDomain,
        resolvedVisibility,
        context.categoryPath,
        effectiveFrom,
        effectiveTo
      )
    );
  }

  return {
    version: 2,
    generated_at: new Date().toISOString(),
    source,
    policies,
  };
}

function assertUniquePolicyIds(policies: PolicyRecord[], source: "live" | "draft"): void {
  const seen = new Map<string, string>();

  for (const policy of policies) {
    const policyId = String(policy.policy_id ?? "").trim();
    if (!policyId) {
      throw new Error(`Empty policy_id found in ${source} scope at ${policy.path}.`);
    }

    const existingPath = seen.get(policyId);
    if (existingPath) {
      throw new Error(
        `Duplicate policy_id '${policyId}' detected in ${source} scope: ${existingPath} and ${policy.path}.`
      );
    }

    seen.set(policyId, policy.path);
  }
}

function getGitOutput(args: string[]): string | null {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.status !== 0) {
    return null;
  }

  return normalizeString(result.stdout);
}

function parseInteger(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parsePrNumberFromText(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const match = /#(\d+)\b/.exec(value);
  return match ? parseInteger(match[1]) : null;
}

async function readGitHubEventPayload(): Promise<Record<string, unknown> | null> {
  const eventPath = normalizeString(process.env.GITHUB_EVENT_PATH);
  if (!eventPath) {
    return null;
  }

  try {
    const raw = await fs.readFile(eventPath, "utf8");
    return asRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function buildExportMetadata(
  livePayload: ExportPayload
): Promise<ExportMetadataPayload> {
  const eventPayload = await readGitHubEventPayload();
  const pullRequest = asRecord(eventPayload?.pull_request);
  const headCommit = asRecord(eventPayload?.head_commit);

  const prNumberFromEnv =
    parseInteger(normalizeString(process.env.PUBLISH_PR_NUMBER)) ??
    parseInteger(normalizeString(process.env.GITHUB_PR_NUMBER));
  const prNumberFromEvent =
    (typeof pullRequest?.number === "number" ? pullRequest.number : null) ??
    (typeof eventPayload?.number === "number" ? eventPayload.number : null);
  const prNumberFromMessage =
    parsePrNumberFromText(normalizeString(headCommit?.message)) ??
    parsePrNumberFromText(getGitOutput(["show", "-s", "--format=%B", "HEAD"]));

  const prNumber = prNumberFromEnv ?? prNumberFromEvent ?? prNumberFromMessage;

  return {
    version: 1,
    contract: "alice-publisher-v1",
    export_schema_version: livePayload.version,
    generated_at: livePayload.generated_at,
    artifacts: {
      policies: "exports/policies.json",
      policies_draft: "exports/policies-draft.json",
      index: "exports/index.json",
    },
    publish: {
      source_system: normalizeString(process.env.PUBLISH_SOURCE_SYSTEM),
      actor_id: normalizeString(process.env.PUBLISH_ACTOR_ID),
      request_id: normalizeString(process.env.PUBLISH_REQUEST_ID),
      pr_number: prNumber,
      merge_commit:
        normalizeString(process.env.PUBLISH_MERGE_COMMIT) ??
        normalizeString(process.env.GITHUB_SHA) ??
        getGitOutput(["rev-parse", "HEAD"]),
    },
  };
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function buildIndex(livePayload: ExportPayload): Promise<IndexPayload> {
  return {
    version: 2,
    generated_at: livePayload.generated_at,
    policies: livePayload.policies.map((policy) => ({
      policy_id: policy.policy_id,
      title: policy.title,
      status: policy.status,
      type: policy.type,
      effective_from: policy.effective_from,
      effective_to: policy.effective_to,
      visibility: policy.visibility,
      section_ids: policy.sections.map((section) => section.section_id),
      tags: policy.tags,
      path: policy.path,
    })),
  };
}

async function main(): Promise<void> {
  const livePayload = await loadPolicies("live/**/*.md", "live", true);
  const draftPayload = await loadPolicies("draft/**/*.md", "draft", false);
  assertUniquePolicyIds(livePayload.policies, "live");

  await writeJson(path.join(process.cwd(), "exports/policies.json"), livePayload);
  await writeJson(
    path.join(process.cwd(), "exports/policies-draft.json"),
    draftPayload
  );

  const indexPayload = await buildIndex(livePayload);
  await writeJson(path.join(process.cwd(), "exports/index.json"), indexPayload);

  const metadataPayload = await buildExportMetadata(livePayload);
  await writeJson(path.join(process.cwd(), "exports/metadata.json"), metadataPayload);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
