// Copyright (c) 2026 LSP SOFTWARE LTD
// SPDX-License-Identifier: AGPL-3.0-only AND LicenseRef-Commons-Clause
// See LICENSE.md for full terms.

import { verifyStorageConnectivity } from "@openbeacon/api";
import type { AuthType } from "@openbeacon/auth";
import { Hono } from "hono";
import { env } from "./env.ts";
import { tryCatch } from "./helpers/tryCatch.ts";
import authRouter from "./routes/auth.ts";
import trpcRouter from "./routes/trpc.ts";

const storageCheck = await tryCatch(verifyStorageConnectivity());
if (storageCheck.error) {
  console.error(`[startup] ${storageCheck.error.message}`);
}

const app = new Hono<{ Variables: AuthType }>();

const routes = [authRouter, trpcRouter] as const;

routes.forEach((route) => {
  app.basePath("/api").route("/", route);
});

export default {
  fetch: app.fetch,
  port: env.OPENBEACON_API_PORT,
  hostname: env.OPENBEACON_API_HOSTNAME,
};
