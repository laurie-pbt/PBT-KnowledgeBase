import fs from "fs/promises";
import path from "path";

const LIVE_VISIBILITY_VALUES = new Set(["public", "internal"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

async function main(): Promise<void> {
  const livePath = path.join(process.cwd(), "exports/policies.json");
  const draftPath = path.join(process.cwd(), "exports/policies-draft.json");
  const indexPath = path.join(process.cwd(), "exports/index.json");

  const [liveJson, draftJson, indexJson] = await Promise.all([
    readJson(livePath),
    readJson(draftPath),
    readJson(indexPath),
  ]);

  assertCondition(isRecord(liveJson), "exports/policies.json is not an object.");
  assertCondition(isRecord(draftJson), "exports/policies-draft.json is not an object.");
  assertCondition(isRecord(indexJson), "exports/index.json is not an object.");

  const livePolicies = liveJson.policies;
  const draftPolicies = draftJson.policies;
  const indexPolicies = indexJson.policies;

  assertCondition(Array.isArray(livePolicies), "exports/policies.json.policies must be an array.");
  assertCondition(Array.isArray(draftPolicies), "exports/policies-draft.json.policies must be an array.");
  assertCondition(Array.isArray(indexPolicies), "exports/index.json.policies must be an array.");

  for (const [index, policy] of livePolicies.entries()) {
    assertCondition(
      isRecord(policy),
      `exports/policies.json.policies[${index}] must be an object.`
    );
    assertCondition(
      Object.prototype.hasOwnProperty.call(policy, "visibility"),
      `exports/policies.json.policies[${index}] is missing visibility.`
    );
    const liveVisibility = policy.visibility;
    assertCondition(
      typeof liveVisibility === "string",
      `exports/policies.json.policies[${index}].visibility must be a string.`
    );
    assertCondition(
      LIVE_VISIBILITY_VALUES.has(liveVisibility),
      `exports/policies.json.policies[${index}].visibility must be 'public' or 'internal'.`
    );
  }

  for (const [index, policy] of indexPolicies.entries()) {
    assertCondition(
      isRecord(policy),
      `exports/index.json.policies[${index}] must be an object.`
    );
    assertCondition(
      Object.prototype.hasOwnProperty.call(policy, "visibility"),
      `exports/index.json.policies[${index}] is missing visibility.`
    );
    const indexVisibility = policy.visibility;
    assertCondition(
      typeof indexVisibility === "string",
      `exports/index.json.policies[${index}].visibility must be a string.`
    );
    assertCondition(
      LIVE_VISIBILITY_VALUES.has(indexVisibility),
      `exports/index.json.policies[${index}].visibility must be 'public' or 'internal'.`
    );
  }

  for (const [index, policy] of draftPolicies.entries()) {
    assertCondition(
      isRecord(policy),
      `exports/policies-draft.json.policies[${index}] must be an object.`
    );
    assertCondition(
      Object.prototype.hasOwnProperty.call(policy, "visibility"),
      `exports/policies-draft.json.policies[${index}] is missing visibility (expected null when not set).`
    );
    assertCondition(
      policy.visibility === null || typeof policy.visibility === "string",
      `exports/policies-draft.json.policies[${index}].visibility must be a string or null.`
    );
  }

  console.log(
    `Visibility self-check passed: ${livePolicies.length} live, ${indexPolicies.length} index, ${draftPolicies.length} draft.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
