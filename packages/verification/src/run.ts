import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  grantRuntimePermissions,
  installApp,
  isMetroReachable,
  launchDevBuild,
  locateApk,
  setMockLocation,
  settleToApp,
} from "./app.ts";
import { resolveConfig } from "./config.ts";
import { selectDevice } from "./device.ts";
import type { JourneyRun, RunReport } from "./results.ts";
import { overallStatus, writeReport } from "./results.ts";
import { runAndroidCliProbe } from "./runners/androidCli.ts";
import { runMaestroJourney } from "./runners/maestro.ts";
import { sleep } from "./shell.ts";
import { resolveToolVersions } from "./tools.ts";

type Args = {
  runner: "maestro" | "android-cli";
  reps: number;
  journey: string;
  skipLaunch: boolean;
};

const parseArgs = (argv: readonly string[], defaultJourney: string): Args => {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const runner = get("--runner") === "android-cli" ? "android-cli" : "maestro";
  const reps = Number(get("--reps") ?? (runner === "maestro" ? "3" : "1"));
  return {
    runner,
    reps: Number.isFinite(reps) && reps > 0 ? reps : 1,
    journey: get("--journey") ?? defaultJourney,
    skipLaunch:
      argv.includes("--skip-launch") || (runner === "android-cli" && !argv.includes("--fresh")),
  };
};

const backendReachable = async (port: number): Promise<boolean> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`http://localhost:${port}/api/auth/ok`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

const main = async (): Promise<number> => {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "../../..");
  const config = resolveConfig(repoRoot);
  const args = parseArgs(
    process.argv.slice(2),
    join(here, "..", "journeys", "openbeacon-map.maestro.yaml"),
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(config.artifactsRoot, `${args.runner}-${stamp}`);
  mkdirSync(runDir, { recursive: true });

  if (!(await isMetroReachable(config))) {
    console.error(
      `Metro is not reachable on port ${config.metroPort}. Start it with "bun run --cwd apps/mobile start".`,
    );
    return 2;
  }
  if (!(await backendReachable(config.backendPort))) {
    console.error(
      `Local backend is not reachable on :${config.backendPort}. Run "bun run --cwd packages/verification prepare:env" and start the backend.`,
    );
    return 2;
  }

  console.info(`Selecting device (AVD ${config.avdName})...`);
  const device = await selectDevice(config, join(runDir, "emulator.log"));
  console.info(`Using ${device.serial} (API ${device.androidApiLevel}, ${device.model})`);

  const apkPath = locateApk(config);
  if (args.skipLaunch) {
    console.info("Skipping install/launch; probing the current app state.");
    setMockLocation(config, device.serial);
  } else {
    await installApp(config, device.serial, apkPath);
    console.info("Launching development build against Metro...");
    await launchDevBuild(config, device.serial);
    grantRuntimePermissions(config, device.serial);
    setMockLocation(config, device.serial);
    if (!(await settleToApp(config, device.serial))) {
      console.error("App did not settle onto its content screen (dev overlay stuck?).");
      return 2;
    }
    await sleep(1_500);
  }

  const runs: JourneyRun[] = [];
  for (let repetition = 1; repetition <= args.reps; repetition += 1) {
    const repDir = join(runDir, `rep-${repetition}`);
    mkdirSync(repDir, { recursive: true });

    console.info(`Running ${args.runner} repetition ${repetition}/${args.reps}...`);
    const run =
      args.runner === "maestro"
        ? runMaestroJourney(config, device.serial, repetition, args.journey, repDir)
        : runAndroidCliProbe(config, device.serial, repetition, repDir);
    runs.push(run);
    console.info(`  repetition ${repetition}: ${run.status}`);
  }

  const report: RunReport = {
    ticket: "OPE-98",
    journeyName: "OpenBeacon map smoke (throwaway)",
    generatedAt: new Date().toISOString(),
    device,
    app: { packageName: config.packageName, apkPath },
    tools: resolveToolVersions(config),
    runs,
    overallStatus: overallStatus(runs),
  };

  const written = writeReport(report, runDir);
  console.info(`Report: ${written.markdown}`);
  console.info(`Overall: ${report.overallStatus}`);
  return report.overallStatus === "pass" ? 0 : 1;
};

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  });
