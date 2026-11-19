import { auth, emailCodes, push, securityAlerts } from "@openbeacon/auth";
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
import { ReasonError } from "./lib/reasonError.ts";
import { linkRequestDevice } from "./lib/requestDevice.ts";

export const createTRPCContext = async (opts: {
  cache: OpenBeaconCache;
  db: PrismaClient;
  headers: Headers;
  serverVersion: string;
  serverName: string;
  selfHosted: boolean;
  feedbackWebhookUrl?: string | undefined;
}) => {
  const session = await auth.api.getSession({
    headers: opts.headers,
    query: { disableRefresh: true },
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
    push,
    session,
    deviceId: requestDevice?.deviceId ?? null,
    unverifiedDeviceId: requestDevice?.unverifiedDeviceId ?? null,
    deviceActive: requestDevice?.deviceActive ?? false,
    serverVersion: opts.serverVersion,
    serverName: opts.serverName,
    selfHosted: opts.selfHosted,
    feedbackWebhookUrl: opts.feedbackWebhookUrl ?? null,
  };
};
export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;
export type TRPCMeta = {
  rateLimit?: {
    cost?: number;
    namespace?: string;
    scope?: "server";
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
      isDev: false,
      errorFormatter: ({ shape, error }) => {
        if (error.code === "INTERNAL_SERVER_ERROR") {
          return {
            ...shape,
            message: "Something went wrong. Please try again.",
            data: {
              code: shape.data.code,
              httpStatus: shape.data.httpStatus,
              zodError: null,
              cause: null,
              reason: null,
            },
          };
        }
        const reason = error.cause instanceof ReasonError ? error.cause.reason : null;
        if (error.code === "TOO_MANY_REQUESTS") {
          return {
            ...shape,
            message:
              error.message === "" ||
              error.message === error.code ||
              error.message === error.cause?.message
                ? "Too many requests. Please try again later."
                : error.message,
            data: {
              code: shape.data.code,
              httpStatus: shape.data.httpStatus,
              zodError: null,
              cause: null,
              reason,
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
            reason,
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
