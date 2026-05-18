import { defineConfig } from "tsup";

// Emits a single self-contained dist/api-types.d.ts (all tRPC/zod/Prisma
// types inlined via dts.resolve) so the frontend repo needs ZERO backend
// dependencies to stay type-safe.
export default defineConfig({
  entry: ["src/api-types.ts"],
  outDir: "dist",
  format: ["esm"],
  dts: { only: true, resolve: true },
  clean: false,
});
