import fs from "fs/promises";
import path from "path";

type JsonObject = Record<string, unknown>;

type PolicyMode = "live" | "draft";

const DOMAIN_VALUES = ["merchandise", "workshops", "online-training"];
const VISIBILITY_VALUES = ["public", "internal"];
const POLICY_RECORD_KEYS = [
  "policy_id",
  "title",
  "status",
  "type",
  "domain",
  "visibility",
  "category_path",
  "effective_from",
  "effective_to",
  "priority",
  "owner_team",
  "approvers",
  "jurisdiction",
  "applies_to",
  "tags",
  "path",
  "sections",
  "raw_markdown",
];
const SECTION_KEYS = ["section_id", "heading", "content"];
const INDEX_KEYS = ["version", "generated_at", "policies"];
const INDEX_RECORD_KEYS = [
  "policy_id",
  "title",
  "status",
  "type",
  "effective_from",
  "effective_to",
  "visibility",
  "section_ids",
  "tags",
  "path",
];
const METADATA_KEYS = [
  "version",
  "contract",
  "export_schema_version",
  "generated_at",
  "artifacts",
  "publish",
];
const METADATA_ARTIFACT_KEYS = ["policies", "policies_draft", "index"];
const METADATA_PUBLISH_KEYS = [
  "source_system",
  "actor_id",
  "request_id",
  "pr_number",
  "merge_commit",
];

function fail(message: string): never {
  throw new Error(message);
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readJson(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

function assertExactKeys(value: JsonObject, expectedKeys: string[], context: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();

  if (actual.length !== expected.length) {
    fail(`${context} has unexpected key count. Expected [${expected.join(", ")}], got [${actual.join(", ")}].`);
  }

  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail(`${context} is missing required key '${key}'.`);
    }
  }

  for (const key of actual) {
    if (!expected.includes(key)) {
      fail(`${context} has unexpected key '${key}'.`);
    }
  }
}

function asNonEmptyString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${context} must be a non-empty string.`);
  }
  return value;
}

function asString(value: unknown, context: string): string {
  if (typeof value !== "string") {
    fail(`${context} must be a string.`);
  }
  return value;
}

function assertNumber(value: unknown, context: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${context} must be a finite number.`);
  }
}

function assertInteger(value: unknown, context: string): void {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(`${context} must be an integer.`);
  }
}

function assertStringArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value)) {
    fail(`${context} must be an array.`);
  }

  return value.map((entry, index) => asString(entry, `${context}[${index}]`));
}

function assertIsoDate(value: unknown, context: string): string {
  const date = asString(value, context);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    fail(`${context} must match YYYY-MM-DD.`);
  }

  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    fail(`${context} is not a valid date.`);
  }

  return date;
}

function assertIsoDateOrNull(value: unknown, context: string): string | null {
  if (value === null) {
    return null;
  }

  return assertIsoDate(value, context);
}

function assertDateTime(value: unknown, context: string): string {
  const dateTime = asString(value, context);
  if (!dateTime.includes("T")) {
    fail(`${context} must be ISO-8601 date-time.`);
  }
  if (Number.isNaN(Date.parse(dateTime))) {
    fail(`${context} is not a valid ISO-8601 date-time.`);
  }
  return dateTime;
}

function assertEnum(value: unknown, allowedValues: readonly string[], context: string): string {
  const parsed = asString(value, context);
  if (!allowedValues.includes(parsed)) {
    fail(`${context} must be one of: ${allowedValues.join(", ")}.`);
  }
  return parsed;
}

function assertHex64(value: unknown, context: string): string {
  const parsed = asString(value, context);
  if (!/^[a-f0-9]{64}$/.test(parsed)) {
    fail(`${context} must be a 64-char lowercase hex string.`);
  }
  return parsed;
}

function assertSection(value: unknown, context: string): string {
  if (!isObject(value)) {
    fail(`${context} must be an object.`);
  }

  assertExactKeys(value, SECTION_KEYS, context);
  const sectionId = assertHex64(value.section_id, `${context}.section_id`);
  asNonEmptyString(value.heading, `${context}.heading`);
  asString(value.content, `${context}.content`);

  return sectionId;
}

function assertPolicyRecord(value: unknown, mode: PolicyMode, context: string): string {
  if (!isObject(value)) {
    fail(`${context} must be an object.`);
  }

  assertExactKeys(value, POLICY_RECORD_KEYS, context);

  const policyId = asNonEmptyString(value.policy_id, `${context}.policy_id`);
  asNonEmptyString(value.title, `${context}.title`);
  asNonEmptyString(value.status, `${context}.status`);
  asNonEmptyString(value.type, `${context}.type`);
  assertEnum(value.domain, DOMAIN_VALUES, `${context}.domain`);

  if (mode === "live") {
    assertEnum(value.visibility, VISIBILITY_VALUES, `${context}.visibility`);
    assertIsoDate(value.effective_from, `${context}.effective_from`);
    const categoryPath = asString(value.category_path, `${context}.category_path`);
    if (!/^live\/(perpetual|temporary)\/(merchandise|workshops|online-training)$/.test(categoryPath)) {
      fail(`${context}.category_path must be under live/perpetual|temporary/<domain>.`);
    }
    const policyPath = asString(value.path, `${context}.path`);
    if (!policyPath.startsWith("live/")) {
      fail(`${context}.path must start with 'live/'.`);
    }
  } else {
    if (value.visibility !== null) {
      assertEnum(value.visibility, VISIBILITY_VALUES, `${context}.visibility`);
    }
    if (value.effective_from !== null) {
      assertIsoDate(value.effective_from, `${context}.effective_from`);
    }
    const categoryPath = asString(value.category_path, `${context}.category_path`);
    if (!categoryPath.startsWith("draft/")) {
      fail(`${context}.category_path must start with 'draft/'.`);
    }
    const policyPath = asString(value.path, `${context}.path`);
    if (!policyPath.startsWith("draft/")) {
      fail(`${context}.path must start with 'draft/'.`);
    }
  }

  assertIsoDateOrNull(value.effective_to, `${context}.effective_to`);
  assertNumber(value.priority, `${context}.priority`);
  asNonEmptyString(value.owner_team, `${context}.owner_team`);
  assertStringArray(value.approvers, `${context}.approvers`);
  assertStringArray(value.jurisdiction, `${context}.jurisdiction`);
  assertStringArray(value.applies_to, `${context}.applies_to`);
  assertStringArray(value.tags, `${context}.tags`);
  asString(value.raw_markdown, `${context}.raw_markdown`);

  if (!Array.isArray(value.sections)) {
    fail(`${context}.sections must be an array.`);
  }

  const seenSectionIds = new Set<string>();
  for (let index = 0; index < value.sections.length; index += 1) {
    const sectionId = assertSection(value.sections[index], `${context}.sections[${index}]`);
    if (seenSectionIds.has(sectionId)) {
      fail(`${context}.sections has duplicate section_id '${sectionId}'.`);
    }
    seenSectionIds.add(sectionId);
  }

  return policyId;
}

function assertIndexRecord(value: unknown, context: string): { policyId: string; sectionIds: string[] } {
  if (!isObject(value)) {
    fail(`${context} must be an object.`);
  }

  assertExactKeys(value, INDEX_RECORD_KEYS, context);

  const policyId = asNonEmptyString(value.policy_id, `${context}.policy_id`);
  asNonEmptyString(value.title, `${context}.title`);
  asNonEmptyString(value.status, `${context}.status`);
  asNonEmptyString(value.type, `${context}.type`);
  assertIsoDateOrNull(value.effective_from, `${context}.effective_from`);
  assertIsoDateOrNull(value.effective_to, `${context}.effective_to`);

  if (value.visibility !== null) {
    assertEnum(value.visibility, VISIBILITY_VALUES, `${context}.visibility`);
  }

  const sectionIdsRaw = value.section_ids;
  if (!Array.isArray(sectionIdsRaw)) {
    fail(`${context}.section_ids must be an array.`);
  }

  const sectionIds = sectionIdsRaw.map((sectionId, index) =>
    assertHex64(sectionId, `${context}.section_ids[${index}]`)
  );

  const pathValue = asString(value.path, `${context}.path`);
  if (!pathValue.startsWith("live/")) {
    fail(`${context}.path must start with 'live/'.`);
  }

  assertStringArray(value.tags, `${context}.tags`);

  return { policyId, sectionIds };
}

function readSchemaConst(schema: unknown, fieldName: string, context: string): number {
  if (!isObject(schema) || !isObject(schema.properties)) {
    fail(`${context} is missing 'properties'.`);
  }

  const field = schema.properties[fieldName];
  if (!isObject(field) || typeof field.const !== "number") {
    fail(`${context} must declare properties.${fieldName}.const as number.`);
  }

  return field.const;
}

async function main(): Promise<void> {
  const root = process.cwd();

  const policiesPath = path.join(root, "exports", "policies.json");
  const draftPath = path.join(root, "exports", "policies-draft.json");
  const indexPath = path.join(root, "exports", "index.json");
  const metadataPath = path.join(root, "exports", "metadata.json");

  const policiesSchemaPath = path.join(root, "contracts", "exports", "v2", "policies.schema.json");
  const draftSchemaPath = path.join(root, "contracts", "exports", "v2", "policies-draft.schema.json");
  const indexSchemaPath = path.join(root, "contracts", "exports", "v2", "index.schema.json");
  const metadataSchemaPath = path.join(root, "contracts", "exports", "v2", "metadata.schema.json");

  const [
    policiesRaw,
    draftRaw,
    indexRaw,
    metadataRaw,
    policiesSchemaRaw,
    draftSchemaRaw,
    indexSchemaRaw,
    metadataSchemaRaw,
  ] = await Promise.all([
    readJson(policiesPath),
    readJson(draftPath),
    readJson(indexPath),
    readJson(metadataPath),
    readJson(policiesSchemaPath),
    readJson(draftSchemaPath),
    readJson(indexSchemaPath),
    readJson(metadataSchemaPath),
  ]);

  if (!isObject(policiesRaw)) {
    fail("exports/policies.json must be an object.");
  }
  if (!isObject(draftRaw)) {
    fail("exports/policies-draft.json must be an object.");
  }
  if (!isObject(indexRaw)) {
    fail("exports/index.json must be an object.");
  }
  if (!isObject(metadataRaw)) {
    fail("exports/metadata.json must be an object.");
  }

  const policiesVersionFromSchema = readSchemaConst(
    policiesSchemaRaw,
    "version",
    "contracts/exports/v2/policies.schema.json"
  );
  const draftVersionFromSchema = readSchemaConst(
    draftSchemaRaw,
    "version",
    "contracts/exports/v2/policies-draft.schema.json"
  );
  const indexVersionFromSchema = readSchemaConst(
    indexSchemaRaw,
    "version",
    "contracts/exports/v2/index.schema.json"
  );

  assertExactKeys(policiesRaw, ["version", "generated_at", "source", "policies"], "exports/policies.json");
  assertExactKeys(draftRaw, ["version", "generated_at", "source", "policies"], "exports/policies-draft.json");
  assertExactKeys(indexRaw, INDEX_KEYS, "exports/index.json");
  assertExactKeys(metadataRaw, METADATA_KEYS, "exports/metadata.json");

  assertInteger(policiesRaw.version, "exports/policies.json.version");
  assertInteger(draftRaw.version, "exports/policies-draft.json.version");
  assertInteger(indexRaw.version, "exports/index.json.version");
  assertInteger(metadataRaw.version, "exports/metadata.json.version");

  if (policiesRaw.version !== policiesVersionFromSchema) {
    fail(`exports/policies.json.version (${policiesRaw.version}) does not match schema const (${policiesVersionFromSchema}).`);
  }
  if (draftRaw.version !== draftVersionFromSchema) {
    fail(`exports/policies-draft.json.version (${draftRaw.version}) does not match schema const (${draftVersionFromSchema}).`);
  }
  if (indexRaw.version !== indexVersionFromSchema) {
    fail(`exports/index.json.version (${indexRaw.version}) does not match schema const (${indexVersionFromSchema}).`);
  }

  assertDateTime(policiesRaw.generated_at, "exports/policies.json.generated_at");
  assertDateTime(draftRaw.generated_at, "exports/policies-draft.json.generated_at");
  assertDateTime(indexRaw.generated_at, "exports/index.json.generated_at");

  if (policiesRaw.source !== "live") {
    fail("exports/policies.json.source must be 'live'.");
  }
  if (draftRaw.source !== "draft") {
    fail("exports/policies-draft.json.source must be 'draft'.");
  }

  if (!Array.isArray(policiesRaw.policies)) {
    fail("exports/policies.json.policies must be an array.");
  }
  if (!Array.isArray(draftRaw.policies)) {
    fail("exports/policies-draft.json.policies must be an array.");
  }
  if (!Array.isArray(indexRaw.policies)) {
    fail("exports/index.json.policies must be an array.");
  }

  const livePolicyIds = new Set<string>();
  const liveSectionsByPolicyId = new Map<string, string[]>();

  for (let index = 0; index < policiesRaw.policies.length; index += 1) {
    const policyId = assertPolicyRecord(
      policiesRaw.policies[index],
      "live",
      `exports/policies.json.policies[${index}]`
    );

    if (livePolicyIds.has(policyId)) {
      fail(`exports/policies.json has duplicate policy_id '${policyId}'.`);
    }
    livePolicyIds.add(policyId);

    const record = policiesRaw.policies[index] as JsonObject;
    const sections = (record.sections as unknown[]).map((section) =>
      ((section as JsonObject).section_id as string)
    );
    liveSectionsByPolicyId.set(policyId, sections);
  }

  const draftPolicyIds = new Set<string>();
  for (let index = 0; index < draftRaw.policies.length; index += 1) {
    const policyId = assertPolicyRecord(
      draftRaw.policies[index],
      "draft",
      `exports/policies-draft.json.policies[${index}]`
    );

    if (draftPolicyIds.has(policyId)) {
      fail(`exports/policies-draft.json has duplicate policy_id '${policyId}'.`);
    }
    draftPolicyIds.add(policyId);
  }

  const indexPolicyIds = new Set<string>();
  for (let index = 0; index < indexRaw.policies.length; index += 1) {
    const parsed = assertIndexRecord(indexRaw.policies[index], `exports/index.json.policies[${index}]`);
    if (indexPolicyIds.has(parsed.policyId)) {
      fail(`exports/index.json has duplicate policy_id '${parsed.policyId}'.`);
    }
    indexPolicyIds.add(parsed.policyId);

    const liveSectionIds = liveSectionsByPolicyId.get(parsed.policyId);
    if (!liveSectionIds) {
      fail(`exports/index.json contains policy_id '${parsed.policyId}' not found in exports/policies.json.`);
    }

    const expected = [...liveSectionIds].sort().join(",");
    const actual = [...parsed.sectionIds].sort().join(",");
    if (expected !== actual) {
      fail(`exports/index.json section_ids mismatch for policy_id '${parsed.policyId}'.`);
    }
  }

  if (indexPolicyIds.size !== livePolicyIds.size) {
    fail("exports/index.json policy count must match exports/policies.json.");
  }

  if (indexRaw.generated_at !== policiesRaw.generated_at) {
    fail("exports/index.json.generated_at must equal exports/policies.json.generated_at.");
  }

  const metadataVersionFromSchema = readSchemaConst(
    metadataSchemaRaw,
    "version",
    "contracts/exports/v2/metadata.schema.json"
  );
  if (metadataRaw.version !== metadataVersionFromSchema) {
    fail(`exports/metadata.json.version (${metadataRaw.version}) does not match schema const (${metadataVersionFromSchema}).`);
  }

  if (metadataRaw.contract !== "alice-publisher-v1") {
    fail("exports/metadata.json.contract must be 'alice-publisher-v1'.");
  }

  assertInteger(metadataRaw.export_schema_version, "exports/metadata.json.export_schema_version");
  if (metadataRaw.export_schema_version !== policiesRaw.version) {
    fail("exports/metadata.json.export_schema_version must equal exports/policies.json.version.");
  }

  assertDateTime(metadataRaw.generated_at, "exports/metadata.json.generated_at");
  if (metadataRaw.generated_at !== policiesRaw.generated_at) {
    fail("exports/metadata.json.generated_at must equal exports/policies.json.generated_at.");
  }

  if (!isObject(metadataRaw.artifacts)) {
    fail("exports/metadata.json.artifacts must be an object.");
  }
  assertExactKeys(metadataRaw.artifacts, METADATA_ARTIFACT_KEYS, "exports/metadata.json.artifacts");
  if (metadataRaw.artifacts.policies !== "exports/policies.json") {
    fail("exports/metadata.json.artifacts.policies must be 'exports/policies.json'.");
  }
  if (metadataRaw.artifacts.policies_draft !== "exports/policies-draft.json") {
    fail("exports/metadata.json.artifacts.policies_draft must be 'exports/policies-draft.json'.");
  }
  if (metadataRaw.artifacts.index !== "exports/index.json") {
    fail("exports/metadata.json.artifacts.index must be 'exports/index.json'.");
  }

  if (!isObject(metadataRaw.publish)) {
    fail("exports/metadata.json.publish must be an object.");
  }
  assertExactKeys(metadataRaw.publish, METADATA_PUBLISH_KEYS, "exports/metadata.json.publish");

  const nullableStringFields = ["source_system", "actor_id", "request_id"] as const;
  for (const field of nullableStringFields) {
    const value = metadataRaw.publish[field];
    if (value !== null) {
      asNonEmptyString(value, `exports/metadata.json.publish.${field}`);
    }
  }

  if (metadataRaw.publish.pr_number !== null) {
    assertInteger(metadataRaw.publish.pr_number, "exports/metadata.json.publish.pr_number");
    if ((metadataRaw.publish.pr_number as number) <= 0) {
      fail("exports/metadata.json.publish.pr_number must be greater than 0 when provided.");
    }
  }

  const mergeCommit = metadataRaw.publish.merge_commit;
  if (mergeCommit !== null) {
    const commit = asString(mergeCommit, "exports/metadata.json.publish.merge_commit");
    if (!/^[a-f0-9]{40}$/.test(commit)) {
      fail("exports/metadata.json.publish.merge_commit must be a 40-char lowercase hex commit SHA.");
    }
  }

  console.log(
    `Export contract shape check passed: live=${policiesRaw.policies.length}, draft=${draftRaw.policies.length}, index=${indexRaw.policies.length}, schema=v${policiesRaw.version}.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
