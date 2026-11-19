import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Alert } from "../lib/alert.ts";
import { trpc } from "../lib/api.ts";
import { checkServerCompatibility } from "../lib/apiCompatibility.ts";
import { authClient } from "../lib/auth-client.ts";
import { changeServer } from "../lib/changeServer.ts";
import { getServerUrl, isHostedServer } from "../lib/currentServer.ts";
import { readLostSessions } from "../lib/endSession.ts";
import { serverChangeKeyWarning } from "../lib/keyRemovalWarnings.ts";
import { thisDeviceNoun } from "../lib/thisDeviceNoun.ts";

const serverTooOldMessage = (serverVersion: string | null) =>
  `This server is running version ${serverVersion}, which is too old for this app. Ask whoever runs it to update it. You won’t be able to share your location until it’s updated.`;

export const useServerChange = () => {
  const { data: session } = authClient.useSession();
  const signedIn = Boolean(session?.user.id);
  const recoveryStatus = useQuery({
    ...trpc.accountRecovery.status.queryOptions(),
    enabled: signedIn,
  });

  const warnBeforeChange = async (
    url: string,
    change: () => Promise<void>,
    cancel: () => void = () => {},
  ) => {
    const warning =
      url === getServerUrl()
        ? null
        : serverChangeKeyWarning({
            held: readLostSessions(),
            hasRecoveryPhrase: recoveryStatus.data
              ? Boolean(recoveryStatus.data.recoveryKey)
              : undefined,
            noun: thisDeviceNoun(),
            signedIn,
          });
    if (!warning) {
      await change();
      return;
    }
    Alert.alert("Change server?", warning.message, [
      { text: "Cancel", style: "cancel", onPress: cancel },
      ...(warning.offerRecoverySetup
        ? [
            {
              text: "Set up recovery phrase",
              onPress: () => {
                cancel();
                router.push("/account/recovery-setup");
              },
            },
          ]
        : []),
      {
        text: "Change server",
        style: "destructive",
        onPress: () => void change(),
      },
    ]);
  };

  const checkCompatibilityBeforeSave = async (url: string, save: () => Promise<void>) => {
    const checked = await checkServerCompatibility(url);
    if (checked.verdict === "ok") {
      await save();
      return;
    }
    const [title, message] =
      checked.verdict === null
        ? checked.problem.kind === "notOpenBeacon"
          ? [
              "This isn’t an OpenBeacon server",
              "Something answered at this address, but it isn’t OpenBeacon. Check the address.",
            ]
          : checked.problem.kind === "httpStatus"
            ? [
                "Couldn’t reach this server",
                `The server answered with error ${checked.problem.status}. Check the address and that the server is running.`,
              ]
            : checked.problem.kind === "timeout"
              ? [
                  "Couldn’t reach this server",
                  "The server took too long to answer. Check the address and that the server is running.",
                ]
              : [
                  "Couldn’t reach this server",
                  "Check the address, that the server is running and that it has a valid HTTPS certificate.",
                ]
        : checked.verdict === "appTooOld"
          ? [
              "Update the app first",
              "This server needs a newer version of OpenBeacon. Update the app before using it.",
            ]
          : ["This server needs updating", serverTooOldMessage(checked.serverVersion)];
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: "Save anyway", onPress: () => void save() },
    ]);
  };

  const checkInviteServer = async (url: string, stillWanted: () => boolean): Promise<boolean> => {
    const checked = await checkServerCompatibility(url);
    const { verdict, serverVersion } = checked;
    if (!stillWanted()) return false;
    if (verdict === "ok") return true;
    return new Promise((resolve) => {
      const stop = {
        text: "Cancel",
        style: "cancel" as const,
        onPress: () => resolve(false),
      };
      if (
        checked.verdict === null &&
        (checked.problem.kind === "notOpenBeacon" ||
          (checked.problem.kind === "httpStatus" && checked.problem.status === 404))
      ) {
        Alert.alert(
          "This isn’t an OpenBeacon server",
          "The invite points to an address that isn’t an OpenBeacon server. Ask for a new invite.",
          [{ text: "OK", onPress: () => resolve(false) }],
        );
      } else if (verdict === null) {
        Alert.alert(
          "Couldn’t reach this server",
          "Check your connection. If it still doesn’t work, ask whoever sent the invite to check their server is running.",
          [
            stop,
            {
              text: "Try again",
              onPress: () => resolve(checkInviteServer(url, stillWanted)),
            },
          ],
        );
      } else if (verdict === "appTooOld") {
        Alert.alert(
          "Update the app first",
          "This server needs a newer version of OpenBeacon. Update the app, then open the invite again.",
          [{ text: "OK", onPress: () => resolve(false) }],
        );
      } else {
        Alert.alert("This server needs updating", serverTooOldMessage(serverVersion), [
          stop,
          { text: "Change anyway", onPress: () => resolve(true) },
        ]);
      }
    });
  };

  const changeServerForInvite = async (
    server: string,
    stillWanted: () => boolean,
    beforeChange: () => void,
  ) => {
    const saved = isHostedServer(server) ? "" : server;
    if (!(await checkInviteServer(server, stillWanted))) return false;
    const confirmed = await new Promise<boolean>((resolve) => {
      void warnBeforeChange(
        saved,
        async () => resolve(true),
        () => resolve(false),
      );
    });
    if (!confirmed || !stillWanted()) return false;
    beforeChange();
    await changeServer(saved);
    return true;
  };

  return {
    signedIn,
    warnBeforeChange,
    checkCompatibilityBeforeSave,
    changeServerForInvite,
  };
};
