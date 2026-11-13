import { auth, emailCodes, securityAlerts } from "@openbeacon/auth";
import type { OpenBeaconCache } from "@openbeacon/cache";
import type { PrismaClient } from "@openbeacon/database";
import {
  deviceIdHeader,
  devicePendingCause,
  deviceRemovedCause,
  deviceUnverifiedCause,
  tryCatch,
} from "@openbeacon/shared";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError, z } from "zod";
import { DevicePendingError } from "./lib/deviceActivation.ts";
import { DeviceRemovedError, deviceRemovedError } from "./lib/deviceRemoved.ts";
import { DeviceUnverifiedError } from "./lib/deviceUnverified.ts";
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
  feedbackWebhookUrl?: string | undefined;
}) => {
  const session = await auth.api.getSession({
    headers: opts.headers,
  });
  const requestDeviceId = opts.headers.get(deviceIdHeader);
  const device = requestDeviceId
    ? await tryCatch(
        linkRequestDevice({
          db: opts.db,
          deviceId: requestDeviceId,
          session: session ? { id: session.session.id, userId: session.user.id } : null,
        }),
      )
    : null;
  if (device?.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  if (device?.data?.removed) throw deviceRemovedError();
  const requestDevice = device?.data?.removed === false ? device.data : null;

  return {
    cache: opts.cache,
    db: opts.db,
    emailCodes,
    securityAlerts,
    session,
    deviceId: requestDevice?.deviceId ?? null,
    unverifiedDeviceId: requestDevice?.unverifiedDeviceId ?? null,
    deviceActive: requestDevice?.deviceActive ?? false,
    serverVersion: opts.serverVersion,
    serverName: opts.serverName,
    selfHosted: opts.selfHosted,
    feedbackWebhookUrl: opts.feedbackWebhookUrl ?? null,
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
            data: {
              code: shape.data.code,
              httpStatus: shape.data.httpStatus,
              zodError: null,
              cause: null,
            },
          };
        }
        if (error.code === "INTERNAL_SERVER_ERROR") {
          return {
            ...shape,
            message: "Something went wrong. Please try again.",
            data: {
              code: shape.data.code,
              httpStatus: shape.data.httpStatus,
              zodError: null,
              cause: null,
            },
          };
        }
        if (error.code === "TOO_MANY_REQUESTS") {
          return {
            ...shape,
            message: "Too many requests. Please try again later.",
            data: {
              code: shape.data.code,
              httpStatus: shape.data.httpStatus,
              zodError: null,
              cause: null,
            },
          };
        }
        return {
          ...shape,
          data: {
            ...shape.data,
            cause:
              error.cause instanceof DeviceRemovedError
                ? deviceRemovedCause
                : error.cause instanceof DevicePendingError
                  ? devicePendingCause
                  : error.cause instanceof DeviceUnverifiedError
                    ? deviceUnverifiedCause
                    : null,
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
