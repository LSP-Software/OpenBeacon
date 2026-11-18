import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildIntegrationTestCommand,
  checkSkippedTests,
  findIntegrationTestFiles,
  findSkippedTests,
  findUnmatchedIntegrationFiles,
  listFilesUsingIntegrationFlag,
  readEnvFile,
  redisRestartTestFile,
  repoRoot,
} from "./integration-tests.ts";

const files = await findIntegrationTestFiles(repoRoot);
const unmatched = findUnmatchedIntegrationFiles({
  filesUsingIntegrationFlag: await listFilesUsingIntegrationFlag(repoRoot),
  files,
});
if (unmatched.length > 0) {
  console.error(
    `These test files read OPENBEACON_INTEGRATION but are not named {apps,packages}/*/**/*.integration.test.ts, so no run includes them. Rename them:\n${unmatched.join("\n")}`,
  );
  process.exit(1);
}

const result = buildIntegrationTestCommand({ files, args: process.argv.slice(2) });

if ("error" in result) {
  console.error(result.error);
  process.exit(1);
}

const env: Record<string, string | undefined> = {
  ...process.env,
  ...(await readEnvFile(result.envFile)),
  OPENBEACON_INTEGRATION: "1",
};
const reportDir = await mkdtemp(join(tmpdir(), "openbeacon-integration-"));
const reportFile = join(reportDir, "junit.xml");
const [bun = "bun", subcommand = "test", ...rest] = result.command;
const command = [bun, subcommand, "--reporter=junit", `--reporter-outfile=${reportFile}`, ...rest];

console.log(result.command.join(" "));
const child = Bun.spawn(command, {
  cwd: repoRoot,
  env,
  stdio: ["inherit", "inherit", "inherit"],
});
const exitCode = await child.exited;
const report = await Bun.file(reportFile)
  .text()
  .catch(() => "");
await rm(reportDir, { recursive: true, force: true });
if (exitCode !== 0) process.exit(exitCode);

const filtersByName = result.command.some(
  (arg) => arg.startsWith("-t=") || arg.startsWith("--test-name-pattern="),
);
if (filtersByName) process.exit(0);

const redisRestartContainer = env["REDIS_RESTART_CONTAINER"];
const { unexpected, redisRestartSkipped } = checkSkippedTests({
  skipped: findSkippedTests(report),
  redisRestartContainer,
});

if (redisRestartSkipped && !redisRestartContainer) {
  console.warn(`
\x1b[33m⚠ Skipped ${redisRestartTestFile}: REDIS_RESTART_CONTAINER is not set.
  It stops and starts the Redis container behind REDIS_URL, so give it a throwaway container, never a shared one:

  docker run -d --name openbeacon-redis-restart -p 6390:6379 docker.dragonflydb.io/dragonflydb/dragonfly:v1.31.2
  Copy your env file with REDIS_URL=redis://localhost:6390, then run
  REDIS_RESTART_CONTAINER=openbeacon-redis-restart bun run test:integration --env-file=<copy> ${redisRestartTestFile}
  docker rm -f openbeacon-redis-restart\x1b[0m
`);
}

if (unexpected.length > 0) {
  console.error(
    `Integration runs must not skip tests. These were skipped:\n${unexpected.map((test) => `${test.file}: ${test.name}`).join("\n")}`,
  );
  process.exit(1);
}
