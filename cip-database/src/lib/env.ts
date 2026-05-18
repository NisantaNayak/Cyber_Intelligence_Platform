// Minimal .env loader so scripts and the PrismaClient run without extra flags.
// Reads <cwd>/.env — when consumed as a package, that is the host app's cwd
// (e.g. cip-backend), so the host's .env supplies DATABASE_URL.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

try {
  const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
} catch {
  /* .env optional */
}

export const env = {
  databaseUrl: process.env.DATABASE_URL!,
};
