import { auth, emailCodes, securityAlerts } from "@openbeacon/auth";
import type { OpenBeaconCache } from "@openbeacon/cache";
import type { PrismaClient } from "@openbeacon/database";
import { deviceIdHeader, tryCatch } from "@openbeacon/shared";
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { ZodError, z } from "zod";
import { linkRequestDevice } from "./lib/requestDevice.ts";
import { RateLimitContextError } from "./middlewares/rateLimit.ts";

export const createTRPCContext = async (opts: {
  cache: OpenBeaconCache;
  clientIp?: string;
  db: PrismaClient;
  headers: Headers;
  serverVersion: string;
  serverName: string;
  selfHosted: boolean;
}) => {
  const session = await auth.api.getSession({
    headers: opts.headers,
  });
  const requestDeviceId = opts.headers.get(deviceIdHeader);
  const device =
    session && requestDeviceId
      ? await tryCatch(
          linkRequestDevice({
            db: opts.db,
            deviceId: requestDeviceId,
            sessionId: session.session.id,
            userId: session.user.id,
          }),
        )
      : null;

  return {
    cache: opts.cache,
    db: opts.db,
    emailCodes,
    securityAlerts,
    session,
    deviceId: device?.data ?? null,
    serverVersion: opts.serverVersion,
    serverName: opts.serverName,
    selfHosted: opts.selfHosted,
    ...(opts.clientIp !== undefined ? { clientIp: opts.clientIp } : {}),
  };
};
export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;
export type TRPCMeta = {
  rateLimit?: {
    cost?: number;
    namespace?: string;
    ipLimit?: number;
    limit: number;
    windowMs: number;
  };
};
export const createTRPCComponents = () => {
  const t = initTRPC
    .context<TRPCContext>()
    .meta<TRPCMeta>()
    .create({
      transformer: superjson,
      errorFormatter: ({ shape, error }) => {
        if (error.cause instanceof RateLimitContextError) {
          return {
            ...shape,
            message: "Unable to process request.",
            data: { code: shape.data.code, httpStatus: shape.data.httpStatus, zodError: null },
          };
        }
        if (error.code === "TOO_MANY_REQUESTS") {
          return {
            ...shape,
            message: "Too many requests. Please try again later.",
            data: { code: shape.data.code, httpStatus: shape.data.httpStatus, zodError: null },
          };
        }
        return {
          ...shape,
          data: {
            ...shape.data,
            zodError:
              error.cause instanceof ZodError
                ? z.flattenError(error.cause as ZodError<Record<string, unknown>>)
                : null,
          },
        };
      },
    });

  return {
    createTRPCRouter: t.router,
    t,
  };
};
