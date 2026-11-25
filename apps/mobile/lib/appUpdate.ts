import { tryCatch } from "@openbeacon/shared";
import { getLocales } from "expo-localization";
import { Linking, Platform } from "react-native";
import { z } from "zod";
import OpenBeaconTracking from "../modules/openbeacon-tracking/index.ts";
import { openPlayStore } from "./openPlayStore.ts";
import { storage } from "./storage.ts";
import { appVersion } from "./versions.ts";

export type AppUpdate = {
  key: string;
  latestVersion: string | null;
  store: "Google Play" | "the App Store";
  start: () => Promise<boolean>;
};

const skippedKey = "appUpdate.skipped";

export const isNewerVersion = (candidate: string, installed: string) => {
  const pattern = /^\d+(\.\d+)*$/;
  if (!pattern.test(candidate) || !pattern.test(installed)) return false;
  const left = candidate.split(".").map(Number);
  const right = installed.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
};

const appStoreLookupSchema = z.object({
  results: z.array(
    z.object({
      trackId: z.number().int().positive(),
      version: z.string(),
      minimumOsVersion: z.string().optional(),
    }),
  ),
});

export const appStoreUpdateFromLookup = ({
  response,
  installed,
  osVersion,
}: {
  response: unknown;
  installed: string;
  osVersion: string;
}): { version: string; trackId: number } | null => {
  const parsed = appStoreLookupSchema.safeParse(response);
  const app = parsed.success ? parsed.data.results[0] : undefined;
  if (!app || !isNewerVersion(app.version, installed)) return null;
  if (app.minimumOsVersion && isNewerVersion(app.minimumOsVersion, osVersion)) return null;
  return { version: app.version, trackId: app.trackId };
};

const findAndroidUpdate = async (): Promise<AppUpdate | null> => {
  const check = await tryCatch(OpenBeaconTracking.checkAppUpdate());
  if (check.error || check.data.status === "none") return null;
  return {
    key: `android:${check.data.versionCode}`,
    latestVersion: null,
    store: "Google Play",
    start: async () => {
      const started = await tryCatch(OpenBeaconTracking.startAppUpdate());
      if (!started.error && started.data !== "failed") return started.data === "started";
      await openPlayStore();
      return true;
    },
  };
};

const findIosUpdate = async (): Promise<AppUpdate | null> => {
  const country = getLocales()[0]?.regionCode ?? "gb";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const response = await tryCatch(
    fetch(
      `https://itunes.apple.com/lookup?bundleId=net.openbeacon.app&country=${encodeURIComponent(country.toLowerCase())}&_=${Date.now()}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then((result) => result.json())
      .finally(() => clearTimeout(timer)),
  );
  if (response.error) return null;
  const update = appStoreUpdateFromLookup({
    response: response.data,
    installed: appVersion,
    osVersion: String(Platform.Version),
  });
  if (!update) return null;
  return {
    key: `ios:${update.version}`,
    latestVersion: update.version,
    store: "the App Store",
    start: async () => {
      const opened = await tryCatch(
        Linking.openURL(`itms-apps://apps.apple.com/app/id${update.trackId}`),
      );
      if (!opened.error) return true;
      const website = await tryCatch(
        Linking.openURL(`https://apps.apple.com/app/id${update.trackId}`),
      );
      return !website.error;
    },
  };
};

export const findAppUpdate = async () => {
  const update =
    Platform.OS === "android"
      ? await findAndroidUpdate()
      : Platform.OS === "ios"
        ? await findIosUpdate()
        : null;
  if (!update || storage.getString(skippedKey) === update.key) return null;
  return update;
};

export const skipAppUpdate = (update: AppUpdate) => {
  storage.set(skippedKey, update.key);
};
