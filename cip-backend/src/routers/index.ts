import { router } from "../trpc.js";
import { searchRouter } from "./search.js";
import { entityRouter } from "./entity.js";
import { pivotRouter } from "./pivot.js";
import { statsRouter } from "./stats.js";
import { assetRouter } from "./asset.js";
import { findingRouter } from "./finding.js";

export const appRouter = router({
  search: searchRouter,
  entity: entityRouter,
  pivot: pivotRouter,
  stats: statsRouter,
  asset: assetRouter,
  finding: findingRouter,
});

export type AppRouter = typeof appRouter;
