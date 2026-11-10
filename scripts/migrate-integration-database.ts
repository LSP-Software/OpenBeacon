import { envFileFromArgs, readEnvFile, repoRoot } from "./integration-tests.ts";

const args = process.argv.slice(2);
const invalidArg = args.find((arg) => !arg.startsWith("--env-file="));
if (invalidArg) {
  console.error(`Unexpected argument ${invalidArg}. Use --env-file=<path>.`);
  process.exit(1);
}

const envFile = envFileFromArgs(args);
const env = await readEnvFile(envFile);
if (!env["DATABASE_URL"]) {
  console.error(`${envFile} must set DATABASE_URL.`);
  process.exit(1);
}

const child = Bun.spawn(["bun", "run", "prisma", "migrate", "deploy"], {
  cwd: `${repoRoot}packages/database`,
  env: { ...process.env, ...env },
  stdio: ["inherit", "inherit", "inherit"],
});
process.exit(await child.exited);
