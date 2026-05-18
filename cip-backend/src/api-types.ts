// Public type surface shared with the frontend repo.
// `npm run build:api-types` bundles this (with all transitive types inlined)
// into dist/api-types.d.ts, which the frontend vendors via its
// `npm run sync:api-types` script. Keep this file type-only.
export type { AppRouter } from "./routers/index.js";
