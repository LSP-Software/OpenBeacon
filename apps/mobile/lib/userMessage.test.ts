import { expect, test } from "bun:test";
import { deviceRemovedCause } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";
import { SERVER_UNREACHABLE_MESSAGE } from "./serverUnreachable.ts";
import { userMessage } from "./userMessage.ts";

const serverError = (
  message: string,
  data: {
    code: string;
    httpStatus: number;
    reason?: string | null;
    zodError?: unknown;
  },
) =>
  TRPCClientError.from({
    error: {
      code: -32000,
      message,
      data: { reason: null, zodError: null, ...data },
    },
  });

test("a request that never reached the server asks to check the connection", () => {
  expect(userMessage(new TRPCClientError("Network request failed"))).toBe(
    SERVER_UNREACHABLE_MESSAGE,
  );
  expect(userMessage(new TypeError("Network request failed"))).toBe(SERVER_UNREACHABLE_MESSAGE);
});

test("a lost session says the person was signed out instead of UNAUTHORIZED", () => {
  expect(userMessage(serverError("UNAUTHORIZED", { code: "UNAUTHORIZED", httpStatus: 401 }))).toBe(
    "You’ve been signed out. Sign in again to keep using this phone.",
  );
});

test("reasons the app knows get the app's own wording", () => {
  const withReason = (reason: string) =>
    userMessage(
      serverError("Raw server text", {
        code: "CONFLICT",
        httpStatus: 409,
        reason,
      }),
    );
  expect(withReason("EPOCH_ROTATION_PENDING")).toBe(
    "This group’s keys are changing. Try again in a moment.",
  );
  expect(withReason("GROUP_GONE")).toBe("You’re no longer in this group.");
  expect(withReason(deviceRemovedCause)).toBe("This phone was removed from your account.");
});

test("an input the server's schema rejects never shows the raw validation output", () => {
  const error = serverError('[{"code":"too_small","path":["invites"]}]', {
    code: "BAD_REQUEST",
    httpStatus: 400,
    zodError: { formErrors: [], fieldErrors: { invites: ["Too small"] } },
  });
  expect(userMessage(error)).toBe("Something went wrong. Please try again.");
});

test("the server's own sentence is kept for other refusals", () => {
  expect(
    userMessage(
      serverError("Only owners can do that.", {
        code: "FORBIDDEN",
        httpStatus: 403,
      }),
    ),
  ).toBe("Only owners can do that.");
});

test("errors the app raises itself keep their wording, and anything else gets the fallback", () => {
  expect(userMessage(new Error("This phone can’t use this group’s current key yet."))).toBe(
    "This phone can’t use this group’s current key yet.",
  );
  expect(userMessage("boom")).toBe("Something went wrong. Please try again.");
  expect(userMessage(new Error(""))).toBe("Something went wrong. Please try again.");
});
