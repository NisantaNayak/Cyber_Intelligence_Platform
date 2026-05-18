// Minimal env loader (Node 24 has --env-file, but we also load explicitly
// so scripts run without extra flags).
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
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  port: Number(process.env.PORT ?? 4000),
  authMode: (process.env.AUTH_MODE ?? "mock") as "mock" | "okta",
  oktaIssuer: process.env.OKTA_ISSUER ?? "",
  oktaAudience: process.env.OKTA_AUDIENCE ?? "",
  mockBearerToken: process.env.MOCK_BEARER_TOKEN ?? "dev-token",
  mockDataScope: process.env.MOCK_DATA_SCOPE ?? "*",
  // Allowed browser origins. Comma-separated; defaults to the local Vite
  // dev server. Never reflect arbitrary origins for a security-data API.
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};
