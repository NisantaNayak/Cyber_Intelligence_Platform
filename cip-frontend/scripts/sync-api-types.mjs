// Vendors the backend's bundled tRPC router types into this repo.
// Run `npm run build:api-types` in cip-backend first (or set CIP_BACKEND_DIR).
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const backendDir =
  process.env.CIP_BACKEND_DIR ?? resolve(process.cwd(), "..", "cip-backend");
const src = resolve(backendDir, "dist", "api-types.d.ts");
const dest = resolve(process.cwd(), "src", "api-types.d.ts");

if (!existsSync(src)) {
  console.error(
    `api-types not found at:\n  ${src}\n\n` +
      "Generate it first:  (in cip-backend)  npm run build:api-types\n" +
      "Or set CIP_BACKEND_DIR to the backend repo path.",
  );
  process.exit(1);
}

copyFileSync(src, dest);
console.log(`Synced api-types.d.ts\n  from ${src}\n  to   ${dest}`);
