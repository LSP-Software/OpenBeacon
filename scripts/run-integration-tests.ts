import {
  buildIntegrationTestCommand,
  findIntegrationTestFiles,
  readEnvFile,
  repoRoot,
} from "./integration-tests.ts";

const result = buildIntegrationTestCommand({
  files: await findIntegrationTestFiles(repoRoot),
  args: process.argv.slice(2),
});

if ("error" in result) {
  console.error(result.error);
  process.exit(1);
}

console.log(result.command.join(" "));
const child = Bun.spawn(result.command, {
  cwd: repoRoot,
  env: { ...process.env, ...(await readEnvFile(result.envFile)), OPENBEACON_INTEGRATION: "1" },
  stdio: ["inherit", "inherit", "inherit"],
});
process.exit(await child.exited);
