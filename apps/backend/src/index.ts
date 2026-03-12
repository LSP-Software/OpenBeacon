// Copyright (c) 2026 [LSP SOFTWARE LTD]
// SPDX-License-Identifier: AGPL-3.0-only WITH Commons-Clause
// See LICENSE.md for full terms.

import type { AuthType } from "@openbeacon/auth";
import { Hono } from "hono";
import { env } from "./env";
import authRouter from "./routes/auth";
import trpcRouter from "./routes/trpc";

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
