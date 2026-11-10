export const repoRoot = new URL("..", import.meta.url).pathname;

export const findIntegrationTestFiles = async (root: string): Promise<string[]> =>
  (
    await Array.fromAsync(
      new Bun.Glob("{apps,packages}/*/**/*.integration.test.ts").scan({ cwd: root }),
    )
  )
    .filter((file) => !file.includes("node_modules/"))
    .sort();

export const buildIntegrationTestCommand = ({
  files,
  args,
}: {
  files: string[];
  args: string[];
}): { command: string[] } | { error: string } => {
  const flags = args.filter((arg) => arg.startsWith("-"));
  const paths = args
    .filter((arg) => !arg.startsWith("-"))
    .map((path) => path.replace(/^\.\//, "").replace(/\/$/, ""));
  const selected =
    paths.length === 0
      ? files
      : files.filter((file) => paths.some((path) => file === path || file.startsWith(`${path}/`)));

  if (selected.length === 0) {
    return {
      error:
        paths.length === 0
          ? "No integration test files (*.integration.test.ts) found under apps/ or packages/."
          : `No integration test files found under ${paths.join(", ")}.`,
    };
  }

  const envFileFlags = flags.some((flag) => flag.startsWith("--env-file"))
    ? []
    : ["--env-file=.env.ci"];
  return { command: ["bun", "test", "--isolate", ...envFileFlags, ...flags, ...selected] };
};
