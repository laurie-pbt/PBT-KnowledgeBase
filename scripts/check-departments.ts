import fs from "fs/promises";
import path from "path";
import {
  getDepartmentScaffoldDirectories,
  loadDepartmentsConfig,
} from "./departments-config";

function fail(message: string): never {
  throw new Error(message);
}

async function assertDirectoryExists(absolutePath: string): Promise<void> {
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isDirectory()) {
      fail(`Expected directory but found non-directory path: ${absolutePath}`);
    }
  } catch (error) {
    fail(`Missing required directory: ${absolutePath}`);
  }
}

async function main(): Promise<void> {
  const root = process.cwd();
  const config = await loadDepartmentsConfig(root);

  if (config.departments.length === 0) {
    fail("config/departments.json contains zero departments; at least one is required.");
  }

  let checkedDirectories = 0;
  for (const department of config.departments) {
    const requiredDirs = getDepartmentScaffoldDirectories(department.id);
    for (const relativeDir of requiredDirs) {
      const absolutePath = path.join(root, relativeDir);
      await assertDirectoryExists(absolutePath);
      checkedDirectories += 1;
    }
  }

  console.log(
    `Department structure check passed: departments=${config.departments.length}, directories=${checkedDirectories}.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
