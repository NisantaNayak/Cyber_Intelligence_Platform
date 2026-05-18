// Public surface of @cip/db.
// Consumers (e.g. cip-backend) import the shared PrismaClient instance and
// Prisma types from here instead of depending on `prisma`/schema directly.
export { prisma } from "./lib/db.js";
export { Prisma, PrismaClient } from "@prisma/client";
export type * from "@prisma/client";
