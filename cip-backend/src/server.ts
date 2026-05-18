import "./lib/env.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { appRouter } from "./routers/index.js";
import { authenticate } from "./lib/auth.js";
import { env } from "./lib/env.js";

const app = Fastify({ logger: true });

// Allow only configured origins (default: local Vite). `origin: true`
// would reflect any site's Origin, broadening the browser attack surface
// of an authenticated security-data API.
await app.register(cors, { origin: env.corsOrigin });

app.get("/health", async () => ({ ok: true, authMode: env.authMode }));

await app.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: {
    router: appRouter,
    createContext: async ({ req }: any) => ({
      auth: await authenticate(req.headers["authorization"]),
    }),
  },
});

app
  .listen({ port: env.port, host: "0.0.0.0" })
  .then(() => {
    app.log.info(`CIP API on http://localhost:${env.port}  (auth: ${env.authMode})`);
  })
  .catch((e) => {
    app.log.error(e);
    process.exit(1);
  });
