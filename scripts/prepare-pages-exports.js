const fs = require("fs/promises");
const path = require("path");

const EXPORTS_DIR = path.join(process.cwd(), "exports");
const PUBLIC_DIR = path.join(process.cwd(), "public");
const REQUIRED_FILES = ["policies.json", "index.json"];
const OPTIONAL_FILES = ["policies-draft.json"];

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyFile(fileName) {
  const sourcePath = path.join(EXPORTS_DIR, fileName);
  const destinationPath = path.join(PUBLIC_DIR, fileName);
  await fs.copyFile(sourcePath, destinationPath);
}

async function main() {
  await fs.rm(PUBLIC_DIR, { recursive: true, force: true });
  await fs.mkdir(PUBLIC_DIR, { recursive: true });

  for (const fileName of REQUIRED_FILES) {
    await copyFile(fileName);
  }

  for (const fileName of OPTIONAL_FILES) {
    const sourcePath = path.join(EXPORTS_DIR, fileName);
    if (await fileExists(sourcePath)) {
      await copyFile(fileName);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
