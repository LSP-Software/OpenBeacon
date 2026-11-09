import { afterAll, expect, mock, test } from "bun:test";
import { tryCatch } from "@openbeacon/shared";

const query = mock(async () => []);
const disconnect = mock(async () => {});
const checkS3 = mock(async () => {});
const checkR2 = mock(async () => {});
const destroyS3 = mock(() => {});
const destroyR2 = mock(() => {});
const checkEmail = mock(async () => {});
let runInBackground = (_task: Promise<unknown>) => {};

mock.module("@openbeacon/database", () => ({
  prisma: { $queryRaw: query, $disconnect: disconnect },
}));
mock.module("@openbeacon/api/checkStorage.ts", () => ({ checkS3, checkR2 }));
mock.module("@openbeacon/api/s3client.ts", () => ({ s3Client: { destroy: destroyS3 } }));
mock.module("@openbeacon/api/r2.ts", () => ({ r2Client: { destroy: destroyR2 } }));
mock.module("@openbeacon/email", () => ({
  checkEmail,
  emailEnabled: true,
  sendSecurityAlertEmail: mock(async () => {}),
}));
mock.module("@openbeacon/auth/securityAlerts.ts", () => ({
  createSecurityAlerts: (input: { runInBackground: (task: Promise<unknown>) => void }) => {
    runInBackground = input.runInBackground;
    return {};
  },
}));
process.env["DATABASE_URL"] = "postgresql://localhost:5432/test";
const { checkServices, closeServices } = await import("./services.ts");
afterAll(() => mock.restore());

test("checks all services and closes clients", async () => {
  await checkServices();
  expect(query).toHaveBeenCalledTimes(1);
  expect(checkS3).toHaveBeenCalledTimes(1);
  expect(checkR2).toHaveBeenCalledTimes(1);
  expect(checkEmail).toHaveBeenCalledTimes(1);
  await closeServices();
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(destroyS3).toHaveBeenCalledTimes(1);
  expect(destroyR2).toHaveBeenCalledTimes(1);
});

test("waits for pending security alerts before closing the database", async () => {
  disconnect.mockClear();
  let finishAlert = () => {};
  runInBackground(new Promise<void>((resolve) => (finishAlert = resolve)));
  const closing = closeServices();
  await Bun.sleep(0);
  expect(disconnect).not.toHaveBeenCalled();
  finishAlert();
  await closing;
  expect(disconnect).toHaveBeenCalledTimes(1);
});

test("fails startup when a service check fails without logging credentials", async () => {
  checkS3.mockImplementationOnce(async () => {
    throw new Error("secret test credential");
  });
  const error = mock(() => {});
  const original = console.error;
  console.error = error;
  try {
    await expect(checkServices()).rejects.toThrow("Service connectivity validation failed");
    expect(error.mock.calls.flat().join(" ")).not.toContain("secret test credential");
  } finally {
    console.error = original;
  }
});

test("fails startup when the email provider check fails", async () => {
  checkEmail.mockImplementationOnce(async () => {
    throw new Error("SMTP connection or login failed (EAUTH)");
  });
  const error = mock(() => {});
  const original = console.error;
  console.error = error;
  const result = await tryCatch(checkServices());
  console.error = original;
  expect(result.error?.message).toBe("Service connectivity validation failed");
  expect(error).toHaveBeenCalledWith("  Email: failed");
});
