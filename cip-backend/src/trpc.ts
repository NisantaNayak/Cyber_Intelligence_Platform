import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { AuthContext } from "./lib/auth.js";

export type Context = { auth: AuthContext | null };

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

/** Requires a valid token; exposes ctx.auth (subject + dataScope). */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.auth)
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Missing/invalid bearer token" });
  return next({ ctx: { auth: ctx.auth } });
});
