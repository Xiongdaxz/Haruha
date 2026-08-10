import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const indexHtml = join(projectRoot, "dist", "index.html");

if (!existsSync(indexHtml)) {
  console.error("Missing dist/index.html. Run `bun run build` before packaging.");
  process.exit(1);
}
