// Okta JWT verification with a local mock fallback so the app runs without
// an Okta tenant. AUTH_MODE=okta -> verify via JWKS; AUTH_MODE=mock ->
// accept MOCK_BEARER_TOKEN and grant MOCK_DATA_SCOPE.
import { timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "./env.js";

// A data_scope that matches no row. Used to fail CLOSED when a valid token
// carries no scope claim — never default an unscoped identity to "*".
const DENY_SCOPE = "__no_scope__";

/** Constant-time string compare; false on length mismatch (no early return). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export type AuthContext = {
  subject: string;
  /** RBAC data scope; "*" = unrestricted. Enforced in every query + cache key. */
  dataScope: string;
};

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export async function authenticate(
  authHeader?: string,
): Promise<AuthContext | null> {
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  if (env.authMode === "mock") {
    if (!safeEqual(token, env.mockBearerToken)) return null;
    return { subject: "dev-user", dataScope: env.mockDataScope };
  }

  // AUTH_MODE=okta
  try {
    if (!jwks) jwks = createRemoteJWKSet(new URL(`${env.oktaIssuer}/v1/keys`));
    const { payload } = await jwtVerify(token, jwks, {
      issuer: env.oktaIssuer,
      audience: env.oktaAudience,
      algorithms: ["RS256"], // pin: never accept "none"/HS* key confusion
    });
    if (!payload.sub) return null; // no subject -> not a usable identity
    const claim = payload["data_scope"];
    return {
      subject: String(payload.sub),
      // Fail closed: a valid token without an explicit scope sees nothing,
      // rather than being silently granted unrestricted ("*") access.
      dataScope: typeof claim === "string" && claim.length > 0 ? claim : DENY_SCOPE,
    };
  } catch {
    return null;
  }
}
