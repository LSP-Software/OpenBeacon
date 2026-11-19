import {
  isSharingPaused,
  resolveLocationSharing,
  tryCatch,
  type SharingPreference,
} from "@openbeacon/shared";
import { useIsFocused } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPinIcon, PauseIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { trpc } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import {
  changeLocationSharing,
  getPendingSharingChanges,
  hasLocallyPausedSharing,
  hasRejectedSharingChange,
  serverNow,
  toDeviceClock,
} from "../lib/locationSharing.ts";
import { useAppLock } from "../lib/appLock.ts";
import { authClient } from "../lib/auth-client.ts";
import { formatResumeTime } from "../lib/formatResumeTime.ts";
import { getLocationPermissionWarningTitle } from "../lib/locationPermissions.ts";
import { useLocationPermissions } from "../providers/LocationPermissionProvider.tsx";
import { BottomSheet } from "./ui/BottomSheet.tsx";
import { Button } from "./ui/Button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/Card.tsx";
import { ChoiceList } from "./ui/ChoiceList.tsx";
import { Icon } from "./ui/Icon.tsx";
import { SegmentedControl } from "./ui/SegmentedControl.tsx";
import { Text } from "./ui/Text.tsx";
import { useLoadedSharingState } from "../hooks/useLoadedSharingState.ts";
import { thisDeviceNoun } from "../lib/thisDeviceNoun.ts";

export const LocationSharingCard = ({
  device,
}: {
  device?: SharingPreference & { id: string; name: string; isCurrent: boolean };
}) => {
  const queryClient = useQueryClient();
  useLoadedSharingState();
  const { data: session } = authClient.useSession();
  const isFocused = useIsFocused();
  const sharing = useQuery({
    ...trpc.account.locationSharing.queryOptions(),
    refetchInterval: 60_000,
    subscribed: isFocused,
  });
  const [open, setOpen] = useState(false);
  const { locked, away } = useAppLock();
  const [scope, setScope] = useState<"device" | "account">("device");
  const [duration, setDuration] = useState<15 | 60 | 480 | 1440 | null>(60);
  const [now, setNow] = useState(serverNow);
  const [message, setMessage] = useState<string | null>(null);
  const thisDevice = !device || device.isCurrent;
  const { permissionState } = useLocationPermissions();
  const missingPermission =
    thisDevice && permissionState && !permissionState.isReadyForSharing ? permissionState : null;
  const pending = session?.user.id ? getPendingSharingChanges(session.user.id) : null;
  const pendingDevice = thisDevice ? (pending?.device ?? null) : null;
  const pendingAccount = thisDevice ? (pending?.account ?? null) : null;
  const pendingHere = Boolean(pendingAccount || pendingDevice);
  const rejectedHere = Boolean(
    session?.user.id && thisDevice && !pendingHere && hasRejectedSharingChange(session.user.id),
  );
  const stoppedLocally = Boolean(
    session?.user.id && thisDevice && pendingHere && hasLocallyPausedSharing(session.user.id),
  );
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const pendingPaused = (change: { paused: boolean; pausedUntil: Date | null }) =>
    change.paused && (change.pausedUntil === null || change.pausedUntil.getTime() > now);
  const accountPaused = pendingAccount
    ? pendingPaused(pendingAccount)
    : sharing.data
      ? isSharingPaused(sharing.data.account, now)
      : false;
  const devicePreference = device ?? sharing.data?.device;
  const devicePaused = pendingDevice
    ? pendingPaused(pendingDevice)
    : devicePreference
      ? isSharingPaused(devicePreference, now)
      : false;
  const paused = accountPaused || devicePaused || stoppedLocally;
  const effective =
    sharing.data && devicePreference
      ? resolveLocationSharing(sharing.data.account, devicePreference, now)
      : null;
  const until = effective ? effective.pausedUntil : devicePreference?.sharingPausedUntil;
  const resumeAccount = !device && accountPaused;
  const target = device && !device.isCurrent ? device.name : `this ${thisDeviceNoun()}`;
  const selectScope = (selectedScope: "device" | "account") => {
    const selectedAt = serverNow();
    setNow(selectedAt);
    setScope(selectedScope);
    const pendingChange = selectedScope === "account" ? pendingAccount : pendingDevice;
    if (pendingChange?.paused) {
      setDuration(pendingChange.durationMinutes);
      return;
    }
    const preference = selectedScope === "account" ? sharing.data?.account : devicePreference;
    if (!preference || !isSharingPaused(preference, selectedAt)) {
      setDuration(60);
      return;
    }
    if (preference.sharingPausedUntil === null) {
      setDuration(null);
      return;
    }
    const minutes = preference.sharingChangedAt
      ? (preference.sharingPausedUntil.getTime() - preference.sharingChangedAt.getTime()) / 60_000
      : null;
    setDuration(([15, 60, 480, 1440] as const).find((option) => option === minutes) ?? 60);
  };
  const update = useMutation({
    mutationFn: changeLocationSharing,
    networkMode: "always",
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.account.locationSharing.queryKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.account.listDevices.queryKey() }),
      ]);
    },
  });
  const save = async (pause: boolean, selectedScope = scope) => {
    const expectedRevision =
      selectedScope === "account"
        ? sharing.data?.account.sharingRevision
        : devicePreference?.sharingRevision;
    const result = await tryCatch(
      update.mutateAsync({
        scope: selectedScope,
        ...(device ? { deviceId: device.id } : {}),
        paused: pause,
        durationMinutes: pause ? duration : null,
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
      }),
    );
    if (result.data === "superseded") {
      setMessage(
        "Location sharing was just changed on another device. Check the current setting and try again.",
      );
      return;
    }
    if (result.data === "rejected") {
      setOpen(false);
      setMessage(null);
      return;
    }
    if (!result.error) {
      setOpen(false);
      setMessage(null);
      return;
    }
    setMessage(
      pause
        ? "Couldn’t pause location sharing. Check your connection and try again."
        : "Couldn’t resume location sharing. Check your connection and try again.",
    );
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3">
        <View
          className={cn(
            "size-10 items-center justify-center rounded-full",
            paused ? "bg-warning" : "bg-success-soft",
          )}
        >
          <Icon
            as={paused ? PauseIcon : MapPinIcon}
            className={cn("size-5", paused ? "text-warning-text" : "text-success")}
          />
        </View>
        <View className="flex-1 gap-1">
          <CardTitle>Location sharing{paused ? " paused" : ""}</CardTitle>
          <Text className="text-sm text-secondary">
            {accountPaused
              ? "Paused on all your devices"
              : paused
                ? `Paused on ${target}`
                : missingPermission
                  ? getLocationPermissionWarningTitle(missingPermission)
                  : sharing.isPending
                    ? "Checking sharing status…"
                    : sharing.isError
                      ? "Couldn’t check sharing status"
                      : `Sharing enabled on ${target}`}
          </Text>
        </View>
      </CardHeader>
      <CardContent className="gap-3">
        {paused ? (
          <Text className="text-sm text-tertiary">
            {stoppedLocally
              ? update.isPending
                ? "Pausing…"
                : pendingAccount
                  ? `Sharing stopped on this ${thisDeviceNoun()}. Your groups and other devices will update when we can reach the server.`
                  : `Sharing stopped on this ${thisDeviceNoun()}. Your groups will update when we can reach the server.`
              : `${
                  until && until.getTime() > now
                    ? formatResumeTime(toDeviceClock(until), toDeviceClock(new Date(now)))
                    : "Until you turn it back on"
                }.${thisDevice ? " You can still see your groups’ locations." : ""}`}
          </Text>
        ) : pendingHere && thisDevice && !update.isPending ? (
          <Text className="text-sm text-tertiary">
            Sharing resumed on this {thisDeviceNoun()}. We’ll update your groups when you’re back
            online.
          </Text>
        ) : null}
        {rejectedHere && !update.isPending ? (
          <Text className="text-sm text-tertiary">
            Your last change to location sharing couldn’t be applied, so this shows the current
            setting. Try again if you still want to change it.
          </Text>
        ) : null}
        {!thisDevice && pending?.account ? (
          <Text className="text-sm text-tertiary">
            Your change to all devices is waiting to reach your other devices.
          </Text>
        ) : null}
        {message ? (
          <Text accessibilityLiveRegion="polite" className="text-sm text-foreground">
            {message}
          </Text>
        ) : null}
        <View className="flex-row flex-wrap gap-2">
          {(device ? devicePaused : paused) ? (
            <Button
              size="sm"
              loading={update.isPending}
              onPress={() => save(false, resumeAccount ? "account" : "device")}
            >
              <Text>
                {device && accountPaused
                  ? "Remove device pause"
                  : resumeAccount
                    ? "Resume all devices"
                    : "Resume sharing"}
              </Text>
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            disabled={update.isPending}
            onPress={() => {
              selectScope(resumeAccount ? "account" : "device");
              setMessage(null);
              setOpen(true);
            }}
          >
            <Text>
              {device && accountPaused && !devicePaused
                ? `Pause this ${thisDeviceNoun()} separately`
                : paused
                  ? "Change pause"
                  : "Pause sharing"}
            </Text>
          </Button>
        </View>
        {accountPaused && devicePaused ? (
          <Text className="text-sm text-tertiary">
            {device?.name ?? `This ${thisDeviceNoun()}`} also has its own pause. It will stay paused
            when the account resumes.
          </Text>
        ) : null}
      </CardContent>
      <BottomSheet
        visible={open && !locked && !away}
        onClose={() => setOpen(false)}
        closeLabel="Cancel pause"
      >
        <View className="flex-row items-center justify-between gap-3">
          <Text accessibilityRole="header" className="flex-1 text-xl font-bold">
            Pause location sharing
          </Text>
          <Button size="sm" variant="ghost" onPress={() => setOpen(false)}>
            <Text>Cancel</Text>
          </Button>
        </View>
        <ScrollView contentContainerClassName="gap-4" style={{ maxHeight: 480, flexShrink: 1 }}>
          <Text className="text-sm text-secondary">
            Paused devices disappear from your groups’ maps. Members can see that sharing is paused.
            You can still see their locations.
          </Text>
          {!device ? (
            <View className="gap-2">
              <Text variant="label">Pause on</Text>
              <SegmentedControl
                accessibilityLabel="Devices to pause"
                options={[
                  { value: "device", label: `This ${thisDeviceNoun()}` },
                  { value: "account", label: "All my devices" },
                ]}
                selected={scope}
                disabled={update.isPending}
                onChange={selectScope}
              />
            </View>
          ) : null}
          {device ? <Text className="font-semibold">Pause on {device.name}</Text> : null}
          {scope === "account" ? (
            <Text className="text-sm text-secondary">
              Includes devices added during the pause. Devices already paused will stay paused when
              the account resumes.
            </Text>
          ) : null}
          <View className="gap-2">
            <Text variant="label">For</Text>
            <ChoiceList
              accessibilityLabel="Pause duration"
              options={[
                { value: 15, title: "15 minutes" },
                { value: 60, title: "1 hour" },
                { value: 480, title: "8 hours" },
                { value: 1440, title: "24 hours" },
                { value: null, title: "Until I turn it back on" },
              ]}
              selected={duration}
              disabled={update.isPending}
              onChange={setDuration}
            />
          </View>
          {duration !== null ? (
            <Text className="text-sm text-secondary">
              {formatResumeTime(
                toDeviceClock(new Date(now + duration * 60_000)),
                toDeviceClock(new Date(now)),
              )}
            </Text>
          ) : null}
          {message ? (
            <Text accessibilityLiveRegion="polite" className="text-sm">
              {message}
            </Text>
          ) : null}
        </ScrollView>
        <Button loading={update.isPending} onPress={() => save(true)}>
          <Text>Pause sharing</Text>
        </Button>
      </BottomSheet>
    </Card>
  );
};
