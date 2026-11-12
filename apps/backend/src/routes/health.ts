import { apiCompatibilityLevel, minClientApiCompatibilityLevel } from "@openbeacon/shared";
import { Hono } from "hono";
import { env } from "../env.ts";
import { serverVersion } from "../version.ts";

const router = new Hono();

router.get("/health", (context) =>
  context.json({
    status: "ok",
    version: serverVersion,
    serverName: env.SERVER_NAME,
    apiCompatibilityLevel,
    minClientApiCompatibilityLevel,
  }),
);

export default router;
