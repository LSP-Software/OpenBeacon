import { resolveHistoryShare, tryCatch } from "@openbeacon/shared";
import { useEffect, useRef, useState } from "react";
import { Alert } from "../lib/alert.ts";
import { trpcClient } from "../lib/api.ts";
import { ensureDeviceKeyRegistration } from "../lib/deviceKeys.ts";
import { createHistoryKeyReader, unwrapEpochKeyFromWraps } from "../lib/epochKeys.ts";
import { buildHistoryGpx, buildHistoryJson, loadOwnHistory } from "../lib/historyExport.ts";
import {
  finishHistoryExport,
  shareHistoryExport,
  startHistoryExport,
} from "../lib/historyExportFile.ts";
import { thisDeviceNoun } from "../lib/thisDeviceNoun.ts";
import { userMessage } from "../lib/userMessage.ts";

export const useHistoryExport = () => {
  const [exporting, setExporting] = useState<{
    format: "gpx" | "json";
    done: number;
    total: number;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const cancelExport = () => {
    controller.current?.abort();
    setExporting(null);
  };

  const exportHistory = async (format: "gpx" | "json") => {
    if (controller.current) return;
    const abort = startHistoryExport();
    if (!abort) return;
    controller.current = abort;
    const { signal } = abort;
    setExporting({ format, done: 0, total: 0 });
    const result = await tryCatch(
      (async () => {
        const device = await ensureDeviceKeyRegistration();
        const groups = await trpcClient.groupMembership.list.query(undefined, { signal });
        if (groups.length === 0) return { outcome: "noGroups" as const };
        const getHistoryKey = createHistoryKeyReader(device.userId);
        const [devices, sharing] = await Promise.all([
          trpcClient.account.listDevices.query(undefined, { signal }),
          tryCatch(trpcClient.account.locationSharing.query(undefined, { signal })),
        ]);
        const history = await loadOwnHistory({
          deviceNames: new Map(devices.map(({ id, name }) => [id, name])),
          fetchRange: (input) => trpcClient.groupTracking.historyRange.query(input, { signal }),
          groupIds: groups.map(({ id }) => id),
          historyDays: (groupId) =>
            trpcClient.groupTracking.historyDays.query({ groupId }, { signal }),
          listEpochs: (groupId, cursor) =>
            trpcClient.groupEpoch.listEpochKeyWraps.query(
              { cursor, deviceId: device.deviceId, groupId },
              { signal },
            ),
          onProgress: ({ done, total }) => {
            if (!signal.aborted) setExporting({ format, done, total });
          },
          signal,
          unwrapEpoch: (epoch) =>
            unwrapEpochKeyFromWraps({
              device,
              epochId: epoch.epochId,
              getHistoryKey,
              wraps: epoch,
            }),
          userId: device.userId,
          wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          yieldToUi: () => new Promise((resolve) => setTimeout(resolve, 0)),
        });
        if (history.devices.length === 0) {
          const historyShare = sharing.data?.historyShare;
          return {
            outcome: "empty" as const,
            failedGroups: history.failedGroups,
            undecryptable: history.undecryptable,
            lastLocationOnly:
              !!historyShare &&
              groups.every(
                ({ id }) =>
                  resolveHistoryShare({
                    account: historyShare.account,
                    group:
                      historyShare.groups.find(({ groupId }) => groupId === id)?.historyShare ??
                      null,
                  }) === "LAST_LOCATION",
              ),
          };
        }
        if (history.failedGroups > 0 || history.undecryptable) {
          const saveAnyway = await new Promise<boolean>((resolve) => {
            Alert.alert(
              "Some history is missing",
              [
                history.failedGroups === 0
                  ? null
                  : `We couldn’t load your history from ${history.failedGroups === 1 ? "1 group" : `${history.failedGroups} groups`}.`,
                history.undecryptable
                  ? `Some of your locations couldn’t be decrypted on this ${thisDeviceNoun()}, so they’d be left out of the file.`
                  : null,
                "Save what we have, or cancel and try again later.",
              ]
                .filter((sentence) => sentence !== null)
                .join(" "),
              [
                { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
                { text: "Save anyway", onPress: () => resolve(true) },
              ],
            );
          });
          if (!saveAnyway) return { outcome: "cancelled" as const };
        }
        const exportedAt = Date.now();
        const build = format === "gpx" ? buildHistoryGpx : buildHistoryJson;
        await shareHistoryExport({
          contents: build({ devices: history.devices, exportedAt }),
          exportedAt,
          format,
          signal,
        });
        return { outcome: "shared" as const };
      })(),
    );
    controller.current = null;
    finishHistoryExport(abort);
    setExporting(null);
    if (signal.aborted) return;
    if (result.error) {
      Alert.alert("Couldn’t export your history", userMessage(result.error));
      return;
    }
    const outcome = result.data;
    if (outcome.outcome === "shared" || outcome.outcome === "cancelled") return;
    if (outcome.outcome === "noGroups") {
      Alert.alert(
        "No history to export",
        "You’re not in any groups, so there’s no history to export.",
      );
      return;
    }
    if (outcome.failedGroups > 0) {
      Alert.alert("Couldn’t export your history", "Check your connection and try again.");
    } else if (outcome.undecryptable) {
      Alert.alert(
        "Couldn’t decrypt your history",
        `Your history couldn’t be decrypted on this ${thisDeviceNoun()}. Restore your recovery phrase here, then try again.`,
      );
    } else {
      Alert.alert(
        "No history to export",
        outcome.lastLocationOnly
          ? "You share only your last location, so your groups don’t keep any history to export."
          : "Your groups don’t keep any of your location history yet. Check how much history you share above.",
      );
    }
  };

  return { cancelExport, exportHistory, exporting };
};
