import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { deviceRemovedError } from "./lib/deviceRemoved.ts";
import { ReasonError } from "./lib/reasonError.ts";
import { createTRPCComponents, type TRPCContext } from "./trpc.ts";

const prismaMessage =
  "Invalid `prisma.user.findUnique()` invocation: Can't reach database server at `db:5432`";
const { t } = createTRPCComponents();
const router = t.router({
  crash: t.procedure.query(() => {
    throw new Error(prismaMessage);
  }),
  storageFailure: t.procedure.query(() => {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Upload verification failed.",
      cause: new Error("NoSuchBucket: bucket private-bucket at https://r2.internal"),
    });
  }),
  missing: t.procedure.query(() => {
    throw new TRPCError({ code: "NOT_FOUND", message: "Group member not found" });
  }),
  notMember: t.procedure.query(() => {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this group",
      cause: new ReasonError("NOT_GROUP_MEMBER"),
    });
  }),
  uploadLimit: t.procedure.query(() => {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      cause: new ReasonError("UPLOAD_LIMIT_REACHED"),
    });
  }),
  removed: t.procedure.query(() => {
    throw deviceRemovedError();
  }),
});
const call = async (path: string) => {
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: new Request(`http://localhost/api/trpc/${path}`),
    router,
    createContext: () => ({}) as TRPCContext,
  });
  return { status: response.status, body: await response.text() };
};

describe("tRPC error formatter", () => {
  test("an unexpected error reaches the caller as a generic message without its text", async () => {
    const { status, body } = await call("crash");
    expect(status).toBe(500);
    expect(JSON.parse(body).error.json).toMatchObject({
      message: "Something went wrong. Please try again.",
      data: { code: "INTERNAL_SERVER_ERROR" },
    });
    expect(body).not.toContain("prisma");
    expect(body).not.toContain("db:5432");
  });

  test("an internal error thrown on purpose doesn't pass on its cause either", async () => {
    const { status, body } = await call("storageFailure");
    expect(status).toBe(500);
    expect(JSON.parse(body).error.json.message).toBe("Something went wrong. Please try again.");
    expect(body).not.toContain("private-bucket");
  });

  test("other errors keep their message", async () => {
    const { status, body } = await call("missing");
    expect(status).toBe(404);
    expect(JSON.parse(body).error.json.message).toBe("Group member not found");
    expect(JSON.parse(body).error.json.data.reason).toBeNull();
  });

  test("a reason on the error reaches the caller as data.reason", async () => {
    const notMember = await call("notMember");
    expect(notMember.status).toBe(403);
    expect(JSON.parse(notMember.body).error.json.data).toMatchObject({
      code: "FORBIDDEN",
      reason: "NOT_GROUP_MEMBER",
      cause: null,
    });
    const uploadLimit = await call("uploadLimit");
    expect(uploadLimit.status).toBe(429);
    expect(JSON.parse(uploadLimit.body).error.json.data).toMatchObject({
      code: "TOO_MANY_REQUESTS",
      reason: "UPLOAD_LIMIT_REACHED",
    });
  });

  test("a device cause keeps data.cause and also sends it as data.reason", async () => {
    const { status, body } = await call("removed");
    expect(status).toBe(401);
    expect(JSON.parse(body).error.json.data).toMatchObject({
      cause: "DEVICE_REMOVED",
      reason: "DEVICE_REMOVED",
    });
  });
});
