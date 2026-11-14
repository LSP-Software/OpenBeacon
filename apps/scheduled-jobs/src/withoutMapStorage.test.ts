import { expect, test } from "bun:test";
import { emailEnvSchema } from "@openbeacon/email/config.ts";

test("loads its services and every job without any map storage settings", () => {
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      "-e",
      `await import("${import.meta.dir}/services.ts"); await import("${import.meta.dir}/jobs/index.ts");`,
    ],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => !name.startsWith("MAP_S3_") && !(name in emailEnvSchema),
        ),
      ),
      DATABASE_URL: "postgresql://localhost:5432/test",
    },
  });
  const output = result.stdout.toString() + result.stderr.toString();
  expect(result.exitCode).toBe(0);
  expect(output).toContain("Environment configuration valid");
  expect(output).not.toContain("MAP_S3");
});
