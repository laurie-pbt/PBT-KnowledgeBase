import fs from "fs/promises";
import path from "path";
import { spawnSync } from "child_process";

function fail(message: string): never {
  throw new Error(message);
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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

function isHex40(value: string): boolean {
  return /^[a-f0-9]{40}$/.test(value);
}

function isIsoDateTime(value: string): boolean {
  return value.includes("T") && !Number.isNaN(Date.parse(value));
}

async function main(): Promise<void> {
  const metadataPath = path.join(process.cwd(), "exports", "metadata.json");
  const raw = await fs.readFile(metadataPath, "utf8");
  const metadata = JSON.parse(raw) as Record<string, unknown>;

  const commitSubject = getGitOutput(["show", "-s", "--format=%s", "HEAD"]) || "";
  const isPublishCommit = /^kb\(publish\):\s+\S+/.test(commitSubject);

  if (!isPublishCommit) {
    console.log("Publish audit chain check skipped (HEAD is not a kb(publish) commit).");
    return;
  }

  const publish = metadata.publish as Record<string, unknown> | undefined;
  if (!publish || typeof publish !== "object" || Array.isArray(publish)) {
    fail("exports/metadata.json.publish must be an object for publisher commits.");
  }

  const sourceSystem = normalizeString(publish.source_system);
  if (sourceSystem !== "alice") {
    fail("exports/metadata.json.publish.source_system must be 'alice' for publisher commits.");
  }

  const actorId = normalizeString(publish.actor_id);
  if (!actorId) {
    fail("exports/metadata.json.publish.actor_id must be non-null for publisher commits.");
  }

  const requestId = normalizeString(publish.request_id);
  if (!requestId) {
    fail("exports/metadata.json.publish.request_id must be non-null for publisher commits.");
  }

  const prNumber = publish.pr_number;
  if (typeof prNumber !== "number" || !Number.isInteger(prNumber) || prNumber <= 0) {
    fail("exports/metadata.json.publish.pr_number must be a positive integer for publisher commits.");
  }

  const mergeCommit = normalizeString(publish.merge_commit);
  if (!mergeCommit || !isHex40(mergeCommit)) {
    fail("exports/metadata.json.publish.merge_commit must be a 40-char SHA for publisher commits.");
  }

  const headSha = getGitOutput(["rev-parse", "HEAD"]);
  if (headSha && mergeCommit !== headSha) {
    fail(
      `exports/metadata.json.publish.merge_commit (${mergeCommit}) does not match HEAD (${headSha}) for publisher commits.`
    );
  }

  const generatedAt = normalizeString(metadata.generated_at);
  if (!generatedAt || !isIsoDateTime(generatedAt)) {
    fail("exports/metadata.json.generated_at must be a valid ISO date-time for publisher commits.");
  }

  console.log(
    `Publish audit chain check passed for publisher commit: actor=${actorId}, request_id=${requestId}, pr=${prNumber}.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
