import { spawnSync } from "node:child_process";

export type ExecResult = {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export const exec = (
  command: string,
  args: readonly string[],
  options: { env?: Record<string, string>; timeoutMs?: number; input?: string; cwd?: string } = {},
): ExecResult => {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
    ...(options.input === undefined ? {} : { input: options.input }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });

  const timedOut =
    result.error !== undefined && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT";

  return {
    code: result.status ?? (result.signal ? 137 : 1),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut,
  };
};

export const execBinary = (
  command: string,
  args: readonly string[],
  options: { timeoutMs?: number } = {},
): { code: number; stdout: Buffer } => {
  const result = spawnSync(command, [...args], {
    maxBuffer: 128 * 1024 * 1024,
    ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
  });
  return {
    code: result.status ?? (result.signal ? 137 : 1),
    stdout: result.stdout ?? Buffer.alloc(0),
  };
};

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  { timeoutMs, intervalMs }: { timeoutMs: number; intervalMs: number },
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await sleep(intervalMs);
  }
  return false;
};
