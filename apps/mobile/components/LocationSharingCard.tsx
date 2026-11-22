import {
  isSharingPaused,
  resolveLocationSharing,
  tryCatch,
  type SharingPreference,
} from "@openbeacon/shared";
import { useIsFocused } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPinIcon, PauseIcon, TimerIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { trpc } from "../lib/api.ts";
import { useApiCompatibility } from "../lib/apiCompatibility.ts";
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
import { thisDeviceNoun } from "../lib/thisDeviceNoun.ts";
import { loadTrackingModule } from "../lib/trackingModule.ts";
import { useLocationPermissions } from "../providers/LocationPermissionProvider.tsx";
import { BottomSheet } from "./ui/BottomSheet.tsx";
import { Button } from "./ui/Button.tsx";
import { ChoiceList } from "./ui/ChoiceList.tsx";
import { ListRow, ListSection } from "./ui/List.tsx";
import { SegmentedControl } from "./ui/SegmentedControl.tsx";
import { Switch } from "./ui/Switch.tsx";
import { Text } from "./ui/Text.tsx";
import { useLoadedSharingState } from "../hooks/useLoadedSharingState.ts";

export const LocationSharingCard = ({
  device,
  children,
}: {
  device?: SharingPreference & { id: string; name: string; isCurrent: boolean };
  children?: React.ReactNode;
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
  const compatibilityProblem = useApiCompatibility()?.problem;
  const groups = useQuery({
    ...trpc.groupMembership.list.queryOptions(),
    enabled: thisDevice,
    subscribed: isFocused,
  });
  const sharingKeys = useQuery({
    queryKey: ["thisPhoneHasSharingKeys"],
    queryFn: async () => {
      const trackingModule = await loadTrackingModule();
      return trackingModule ? trackingModule.listProvisionedEpochKeys().length > 0 : null;
    },
    enabled: thisDevice,
    networkMode: "always",
    refetchInterval: 15_000,
    subscribed: isFocused,
  });
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
  const noun = thisDeviceNoun();
  const target = device && !device.isCurrent ? device.name : `this ${noun}`;
  const notSharing =
    !thisDevice || paused || missingPermission
      ? null
      : compatibilityProblem === "appTooOld"
        ? "appTooOld"
        : compatibilityProblem === "outOfSync"
          ? "outOfSync"
          : sharing.isPending || sharing.isError
            ? null
            : groups.data?.length === 0
              ? "noGroups"
              : groups.data && sharingKeys.data === false
                ? "noKeys"
                : null;
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

  const sharingOn = !(device ? devicePaused : paused);
  const status = accountPaused
    ? "Paused on all your devices"
    : paused
      ? `Paused on ${target}`
      : missingPermission
        ? getLocationPermissionWarningTitle(missingPermission)
        : notSharing === "appTooOld"
          ? "Not sharing until you update OpenBeacon"
          : notSharing === "outOfSync"
            ? "Not sharing until the app and server match"
            : notSharing === "noGroups"
              ? "Not sharing: you’re not in any groups"
              : notSharing === "noKeys"
                ? `Not sharing: this ${noun} is waiting for its keys`
                : sharing.isPending
                  ? "Checking sharing status…"
                  : sharing.isError
                    ? "Couldn’t check sharing status"
                    : `Sharing enabled on ${target}`;
  const openPause = () => {
    selectScope(resumeAccount ? "account" : "device");
    setMessage(null);
    setOpen(true);
  };
  const notes = [
    paused
      ? stoppedLocally
        ? update.isPending
          ? "Pausing…"
          : pendingAccount
            ? `Sharing stopped on this ${thisDeviceNoun()}. Your groups and other devices will update when we can reach the server.`
            : `Sharing stopped on this ${thisDeviceNoun()}. Your groups will update when we can reach the server.`
        : `${
            until && until.getTime() > now
              ? formatResumeTime(toDeviceClock(until), toDeviceClock(new Date(now)))
              : "Until you turn it back on"
          }.${thisDevice ? " You can still see your groups’ locations." : ""}`
      : pendingHere && thisDevice && !update.isPending
        ? `Sharing resumed on this ${thisDeviceNoun()}. We’ll update your groups when you’re back online.`
        : null,
    notSharing === "noGroups"
      ? `Create or join a group to start sharing from this ${noun}.`
      : notSharing === "noKeys"
        ? `This ${noun} doesn’t have the keys it needs to share with your groups yet. It keeps trying while it’s online.`
        : null,
    rejectedHere && !update.isPending
      ? "Your last change to location sharing couldn’t be applied, so this shows the current setting. Try again if you still want to change it."
      : null,
    !thisDevice && pending?.account
      ? "Your change to all devices is waiting to reach your other devices."
      : null,
    accountPaused && devicePaused
      ? `${device?.name ?? `This ${thisDeviceNoun()}`} also has its own pause. It will stay paused when the account resumes.`
      : null,
  ].filter((note): note is string => note !== null);

  return (
    <>
      <ListSection
        title="Location sharing"
        footer={
          notes.length > 0 || message ? (
            <View className="gap-1.5">
              {notes.map((note) => (
                <Text key={note} className="text-[13px] leading-[18px] text-secondary">
                  {note}
                </Text>
              ))}
              {message ? (
                <Text
                  accessibilityLiveRegion="polite"
                  className="text-[13px] leading-[18px] text-foreground"
                >
                  {message}
                </Text>
              ) : null}
            </View>
          ) : null
        }
      >
        <ListRow
          title={device && !device.isCurrent ? `Share from ${device.name}` : "Share my location"}
          subtitle={status}
          icon={paused ? PauseIcon : MapPinIcon}
          iconColor={paused || notSharing || missingPermission ? "orange" : "pink"}
          trailing={
            <Switch
              accessibilityLabel={
                device && !device.isCurrent ? `Share from ${device.name}` : "Share my location"
              }
              value={sharingOn}
              disabled={update.isPending}
              onValueChange={(on) => {
                if (on) {
                  void save(false, resumeAccount ? "account" : "device");
                  return;
                }
                openPause();
              }}
            />
          }
        />
        {(device ? devicePaused : paused) || (device && accountPaused) ? (
          <ListRow
            title={
              device && !devicePaused ? `Pause this ${thisDeviceNoun()} separately` : "Change pause"
            }
            icon={TimerIcon}
            iconColor="orange"
            disabled={update.isPending}
            onPress={openPause}
          />
        ) : null}
        {children}
      </ListSection>
      <BottomSheet visible={open && !locked && !away} onClose={() => setOpen(false)}>
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
          <ChoiceList
            title="For"
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
    </>
  );
};
