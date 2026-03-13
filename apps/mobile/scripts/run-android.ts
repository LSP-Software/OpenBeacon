import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tryCatch } from "../lib/tryCatch.ts";

const SUPPORTED_JAVA_MAJORS = [24, 21, 17] as const;

function parseJavaMajor(version: string): number | null {
  const cleaned = version.trim();
  if (!cleaned) return null;
  if (cleaned.startsWith("1.")) {
    return Number.parseInt(cleaned.split(".")[1] ?? "", 10) || null;
  }
  return Number.parseInt(cleaned.split(".")[0] ?? "", 10) || null;
}

function parseJavaVersionOutput(output: string): number | null {
  const match = output.match(/version "([^"]+)"/);
  if (!match?.[1]) return null;
  return parseJavaMajor(match[1]);
}

function getJavaExecutable(javaHome: string): string {
  return join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java");
}

function getBunxExecutable(): string {
  return process.platform === "win32" ? "bunx.cmd" : "bunx";
}

function getEnvValue(name: "JAVA_HOME" | "PATH"): string | undefined {
  return process.env[name];
}

function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env,
      stdio: "inherit",
    });

    child.on("exit", (code, signal) => resolve({ code, signal }));
    child.on("error", () => resolve({ code: 1, signal: null }));
  });
}

function captureCommandOutput(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => {
      resolve(code === 0 ? `${stdout}${stderr}` : null);
    });
    child.on("error", () => resolve(null));
  });
}

async function getJavaMajorFromExecutable(javaExecutable: string): Promise<number | null> {
  const { data: output } = await tryCatch(captureCommandOutput(javaExecutable, ["-version"]));
  if (!output) return null;
  return parseJavaVersionOutput(output);
}

function getLinuxJavaHomes(): string[] {
  return [
    getEnvValue("JAVA_HOME") ?? "",
    "/usr/lib/jvm/java-24-openjdk",
    "/usr/lib/jvm/java-21-openjdk",
    "/usr/lib/jvm/java-17-openjdk",
    "/usr/lib/jvm/default",
    "/usr/lib/jvm/default-runtime",
  ].filter(Boolean);
}

async function getMacJavaHomes(): Promise<string[]> {
  const homes: string[] = [];

  for (const version of SUPPORTED_JAVA_MAJORS) {
    const { data: home } = await tryCatch(
      captureCommandOutput("/usr/libexec/java_home", ["-v", version.toString()]),
    );
    if (home) {
      homes.push(home.trim());
    }
  }

  return homes;
}

async function getCandidateJavaHomes(): Promise<string[]> {
  const homes = process.platform === "darwin" ? await getMacJavaHomes() : getLinuxJavaHomes();

  const seen = new Set<string>();
  return homes.filter((home) => {
    const normalizedHome = home.trim();
    if (!normalizedHome || seen.has(normalizedHome)) return false;
    seen.add(normalizedHome);
    return existsSync(getJavaExecutable(normalizedHome));
  });
}

async function resolveJavaHome(): Promise<{
  javaHome: string | null;
  javaMajor: number | null;
  resolvedFromSystemJava: boolean;
}> {
  const currentJavaMajor = await getJavaMajorFromExecutable(
    process.platform === "win32" ? "java.exe" : "java",
  );

  if (
    currentJavaMajor !== null &&
    SUPPORTED_JAVA_MAJORS.includes(currentJavaMajor as 17 | 21 | 24)
  ) {
    return {
      javaHome: getEnvValue("JAVA_HOME") ?? null,
      javaMajor: currentJavaMajor,
      resolvedFromSystemJava: true,
    };
  }

  const candidateHomes = await getCandidateJavaHomes();
  for (const home of candidateHomes) {
    const major = await getJavaMajorFromExecutable(getJavaExecutable(home));
    if (major !== null && SUPPORTED_JAVA_MAJORS.includes(major as 17 | 21 | 24)) {
      return { javaHome: home, javaMajor: major, resolvedFromSystemJava: false };
    }
  }

  return { javaHome: null, javaMajor: currentJavaMajor, resolvedFromSystemJava: false };
}

async function main(): Promise<number> {
  const { javaHome, javaMajor, resolvedFromSystemJava } = await resolveJavaHome();

  if (javaMajor === null && javaHome === null) {
    console.error(
      "Could not determine a Java runtime for Android builds. Install Java 17, 21, or 24 and set JAVA_HOME.",
    );
    return 1;
  }

  if (javaHome === null && !resolvedFromSystemJava) {
    console.error(
      `Android builds require Java 17, 21, or 24. Current Java is ${javaMajor ?? "unknown"}. Install a supported JDK and set JAVA_HOME.`,
    );
    return 1;
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(javaHome
      ? {
          JAVA_HOME: javaHome,
          PATH: `${join(javaHome, "bin")}${delimiter}${getEnvValue("PATH") ?? ""}`,
        }
      : {}),
  };

  if (!resolvedFromSystemJava) {
    console.log(`Using Java ${javaMajor} from ${javaHome}`);
  }

  const prebuildResult = await runCommand(
    getBunxExecutable(),
    ["expo", "prebuild", "-p", "android"],
    env,
  );
  if (prebuildResult.code !== 0) {
    return prebuildResult.code ?? 1;
  }

  const androidResult = await runCommand(getBunxExecutable(), ["expo", "run:android"], env);
  return androidResult.code ?? 1;
}

const { data: exitCode, error } = await tryCatch(main());

if (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

process.exit(exitCode);
