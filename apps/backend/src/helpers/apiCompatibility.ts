import {
  apiCompatibilityLevel,
  apiCompatibilityLevelHeader,
  minClientApiCompatibilityLevel,
  minClientApiCompatibilityLevelHeader,
  parseApiCompatibilityLevel,
} from "@openbeacon/shared";
import { createMiddleware } from "hono/factory";
import { env } from "../env.ts";

export const apiCompatibility = createMiddleware(async (c, next) => {
  const clientLevel = parseApiCompatibilityLevel(c.req.header(apiCompatibilityLevelHeader)) ?? 0;
  const openedByBrowser =
    c.req.method === "GET" && c.req.path === "/api/auth/google-deletion-callback";
  if (openedByBrowser || clientLevel >= minClientApiCompatibilityLevel) {
    await next();
  } else {
    c.res = c.json(
      {
        code: "CLIENT_TOO_OLD",
        minClientApiCompatibilityLevel,
        message: env.CLIENT_UPDATE_MESSAGE,
      },
      426,
    );
  }
  c.header(apiCompatibilityLevelHeader, String(apiCompatibilityLevel));
  c.header(minClientApiCompatibilityLevelHeader, String(minClientApiCompatibilityLevel));
});

const trimSlashes = (path: string) => {
  const withoutLeading = path.startsWith("/") ? path.slice(1) : path;
  return withoutLeading.endsWith("/") ? withoutLeading.slice(0, -1) : withoutLeading;
};

export const findUnknownProcedure = ({
  url,
  endpoint,
  procedures,
}: {
  url: string;
  endpoint: string;
  procedures: Record<string, unknown>;
}) => {
  const { pathname, searchParams } = new URL(url);
  const path = trimSlashes(trimSlashes(pathname).slice(trimSlashes(endpoint).length));
  if (path === "") return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return undefined;
  }
  const names = searchParams.get("batch") === "1" ? decoded.split(",") : [decoded];
  return names.find((name) => !Object.hasOwn(procedures, name));
};

export const unknownProcedureBody = { code: "UNKNOWN_PROCEDURE", apiCompatibilityLevel } as const;
