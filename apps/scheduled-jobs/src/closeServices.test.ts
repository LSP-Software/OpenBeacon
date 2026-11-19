import { expect, test } from "bun:test";

test("closing the services lets a command exit when email is on and Redis can't be reached", async () => {
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      "-e",
      `const { closeServices } = await import(${JSON.stringify(`${import.meta.dir}/services.ts`)}); await closeServices();`,
    ],
    env: {
      ...process.env,
      SMTP_HOST: "127.0.0.1",
      EMAIL_FROM: "openbeacon@example.com",
      REDIS_URL: "redis://127.0.0.1:1",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  const timer = setTimeout(() => child.kill(), 8_000);
  const exitCode = await child.exited;
  clearTimeout(timer);
  expect(child.signalCode).toBeNull();
  expect(exitCode).toBe(0);
}, 15_000);
