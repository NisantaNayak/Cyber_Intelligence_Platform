import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
// End-to-end type safety: the backend's router type is vendored into this
// repo via `npm run sync:api-types` (generated, committed).
import type { AppRouter } from "./api-types";

const API_URL = "http://localhost:4000/trpc";
const BEARER = "dev-token"; // AUTH_MODE=mock; swap for a real Okta token in prod

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: API_URL,
      transformer: superjson,
      headers: () => ({ Authorization: `Bearer ${BEARER}` }),
    }),
  ],
});
