// The PrismaClient and schema now live in the @cip/db package. This file
// stays as the backend's import point so routers keep importing "../lib/db.js".
export { prisma, Prisma, PrismaClient } from "@cip/db";
