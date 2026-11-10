import { resolve } from "node:path";
import { parseEnv } from "node:util";

export const repoRoot = new URL("..", import.meta.url).pathname;

export const findIntegrationTestFiles = async (root: string): Promise<string[]> =>
  (
    await Array.fromAsync(
      new Bun.Glob("{apps,packages}/*/**/*.integration.test.ts").scan({ cwd: root }),
    )
  )
    .filter((file) => !file.includes("node_modules/"))
    .sort();

export const envFileFromArgs = (args: string[]) =>
  args.findLast((arg) => arg.startsWith("--env-file="))?.slice("--env-file=".length) ?? ".env.ci";

export const buildIntegrationTestCommand = ({
  files,
  args,
}: {
  files: string[];
  args: string[];
}): { command: string[]; envFile: string } | { error: string } => {
  const flags = args.filter((arg) => arg.startsWith("-"));
  const flagWithoutValue = flags.find((flag) => !flag.includes("="));
  if (flagWithoutValue) {
    return {
      error: `Pass flags as --flag=value: use ${flagWithoutValue}=<value>, such as --env-file=<path>.`,
    };
  }

  const paths = args
    .filter((arg) => !arg.startsWith("-"))
    .map((path) => path.replace(/^\.\//, "").replace(/\/$/, ""));
  const isUnder = (file: string, path: string) => file === path || file.startsWith(`${path}/`);

  if (paths.length === 0 && files.length === 0) {
    return {
      error: "No integration test files (*.integration.test.ts) found under apps/ or packages/.",
    };
  }
  const unmatchedPaths = paths.filter((path) => !files.some((file) => isUnder(file, path)));
  if (unmatchedPaths.length > 0) {
    return { error: `No integration test files found under ${unmatchedPaths.join(", ")}.` };
  }

  const envFile = envFileFromArgs(flags);
  const selected =
    paths.length === 0 ? files : files.filter((file) => paths.some((path) => isUnder(file, path)));
  return {
    envFile,
    command: [
      "bun",
      "test",
      "--isolate",
      `--env-file=${envFile}`,
      ...flags.filter((flag) => !flag.startsWith("--env-file=")),
      ...selected,
    ],
  };
};

export const readEnvFile = async (envFile: string): Promise<Record<string, string>> => {
  const file = Bun.file(resolve(repoRoot, envFile));
  if (!(await file.exists())) {
    throw new Error(`Env file ${envFile} not found.`);
  }
  return Object.fromEntries(
    Object.entries(parseEnv(await file.text())).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
};
