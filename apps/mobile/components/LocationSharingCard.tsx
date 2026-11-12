import { isSharingPaused, tryCatch, type SharingPreference } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPinIcon, PauseIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { trpc } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import { changeLocationSharing, hasPendingSharingPause } from "../lib/locationSharing.ts";
import { authClient } from "../lib/auth-client.ts";
import { Button } from "./ui/Button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/Card.tsx";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "./ui/Icon.tsx";
import { Text } from "./ui/Text.tsx";

export const LocationSharingCard = ({
  device,
}: {
  device?: SharingPreference & { id: string; name: string; isCurrent: boolean };
}) => {
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { data: session } = authClient.useSession();
  const sharing = useQuery({
    ...trpc.account.locationSharing.queryOptions(),
    refetchInterval: 15_000,
  });
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"device" | "account">("device");
  const [duration, setDuration] = useState<15 | 60 | 480 | 1440 | null>(60);
  const [now, setNow] = useState(Date.now);
  const [message, setMessage] = useState<string | null>(null);
  const stoppedLocally = Boolean(
    session?.user.id && (!device || device.isCurrent) && hasPendingSharingPause(session.user.id),
  );
  useEffect(() => {
    if (!stoppedLocally) setMessage(null);
  }, [stoppedLocally]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const accountPaused = sharing.data ? isSharingPaused(sharing.data.account, now) : false;
  const devicePreference = device ?? sharing.data?.device;
  const devicePaused = devicePreference ? isSharingPaused(devicePreference, now) : false;
  const paused = accountPaused || devicePaused || stoppedLocally;
  const until = accountPaused
    ? sharing.data?.account.sharingPausedUntil
    : devicePreference?.sharingPausedUntil;
  const target = device && !device.isCurrent ? device.name : "this device";
  const update = useMutation({
    mutationFn: changeLocationSharing,
    onSuccess: () => {
      setOpen(false);
      setMessage(null);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.account.locationSharing.queryKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.account.listDevices.queryKey() }),
      ]);
    },
  });
  const save = async (pause: boolean, selectedScope = scope) => {
    const result = await tryCatch(
      update.mutateAsync({
        scope: selectedScope,
        ...(device ? { deviceId: device.id } : {}),
        paused: pause,
        durationMinutes: pause ? duration : null,
      }),
    );
    if (!result.error) return;
    const localPause = pause && (!device || device.isCurrent || selectedScope === "account");
    setMessage(
      localPause
        ? "Sharing stopped on this device. We couldn't update your groups or other devices. We'll retry when connected."
        : "Couldn't update location sharing. Check your connection and try again.",
    );
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3">
        <View className="size-10 items-center justify-center rounded-full bg-primary/10">
          <Icon as={paused ? PauseIcon : MapPinIcon} className="size-5 text-primary" />
        </View>
        <View className="flex-1 gap-1">
          <CardTitle>Location sharing{paused ? " paused" : ""}</CardTitle>
          <Text className="text-sm text-muted-foreground">
            {sharing.isPending
              ? "Checking sharing status…"
              : sharing.isError
                ? "Couldn't check sharing status"
                : accountPaused
                  ? "Paused on all your devices"
                  : paused
                    ? `Paused on ${target}`
                    : `Sharing enabled on ${target}`}
          </Text>
        </View>
      </CardHeader>
      <CardContent className="gap-3">
        {paused ? (
          <Text className="text-sm text-muted-foreground">
            {stoppedLocally
              ? "Waiting for confirmation from the server"
              : until && until.getTime() > now
                ? `Resumes ${until.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`
                : "Until you turn it back on"}
            . You can still see your groups' locations.
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
              onPress={() => save(false, !device && accountPaused ? "account" : "device")}
            >
              <Text>
                {device && accountPaused
                  ? "Remove device pause"
                  : accountPaused
                    ? "Resume all devices"
                    : "Resume sharing"}
              </Text>
            </Button>
          ) : null}
          <Button
            variant={paused ? "outline" : "default"}
            size="sm"
            disabled={update.isPending}
            onPress={() => {
              setScope(!device && accountPaused ? "account" : "device");
              setOpen(true);
            }}
          >
            <Text>
              {device && accountPaused && !devicePaused
                ? "Pause this device separately"
                : paused
                  ? "Change pause"
                  : "Pause sharing"}
            </Text>
          </Button>
        </View>
        {accountPaused && devicePaused ? (
          <Text className="text-sm text-muted-foreground">
            {device?.name ?? "This device"} also has its own pause. It will stay paused when the
            account resumes.
          </Text>
        ) : null}
      </CardContent>
      <Modal
        transparent
        visible={open}
        animationType="slide"
        onRequestClose={() => !update.isPending && setOpen(false)}
      >
        <View className="flex-1 justify-end bg-black/50">
          <Pressable
            className="absolute inset-0"
            accessibilityRole="button"
            accessibilityLabel="Cancel pause"
            onPress={() => !update.isPending && setOpen(false)}
          />
          <View
            accessibilityViewIsModal
            className="max-h-[90%] gap-4 rounded-t-3xl bg-card px-6 pt-5"
            style={{ paddingBottom: Math.max(insets.bottom, 20) }}
          >
            <View className="flex-row items-center justify-between gap-3">
              <Text className="flex-1 text-xl font-semibold">Pause location sharing</Text>
              <Button
                size="sm"
                variant="ghost"
                disabled={update.isPending}
                onPress={() => setOpen(false)}
              >
                <Text>Cancel</Text>
              </Button>
            </View>
            <ScrollView contentContainerClassName="gap-4" style={{ maxHeight: 480 }}>
              <Text className="text-sm text-muted-foreground">
                Paused devices disappear from your groups' maps. Members can see that sharing is
                paused. You can still see their locations.
              </Text>
              {!device ? (
                <View className="gap-2">
                  <Text className="font-semibold">Pause on</Text>
                  <View accessibilityRole="radiogroup" className="flex-row gap-2">
                    {(["device", "account"] as const).map((option) => (
                      <Pressable
                        key={option}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: scope === option }}
                        onPress={() => setScope(option)}
                        className={cn(
                          "min-h-11 flex-1 items-center justify-center rounded-lg border px-3",
                          scope === option ? "border-primary bg-primary/10" : "border-border",
                        )}
                      >
                        <Text>{option === "device" ? "This device" : "All my devices"}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
              {device ? <Text className="font-semibold">Pause on {device.name}</Text> : null}
              {scope === "account" ? (
                <Text className="text-sm text-muted-foreground">
                  Includes devices added during the pause. Devices already paused will stay paused
                  when the account resumes.
                </Text>
              ) : null}
              <View accessibilityRole="radiogroup" className="gap-2">
                <Text className="font-semibold">For</Text>
                {(
                  [
                    { minutes: 15, label: "15 minutes" },
                    { minutes: 60, label: "1 hour" },
                    { minutes: 480, label: "8 hours" },
                    { minutes: 1440, label: "24 hours" },
                    { minutes: null, label: "Until I turn it back on" },
                  ] as const
                ).map((option) => (
                  <Pressable
                    key={option.label}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: duration === option.minutes }}
                    onPress={() => setDuration(option.minutes)}
                    className={cn(
                      "min-h-11 flex-row items-center justify-between rounded-lg border px-3 py-2",
                      duration === option.minutes
                        ? "border-primary bg-primary/10"
                        : "border-border",
                    )}
                  >
                    <Text>{option.label}</Text>
                    <View
                      className={cn(
                        "size-4 rounded-full border",
                        duration === option.minutes ? "border-primary bg-primary" : "border-border",
                      )}
                    />
                  </Pressable>
                ))}
              </View>
              {duration !== null ? (
                <Text className="text-sm text-muted-foreground">
                  Resumes{" "}
                  {new Date(now + duration * 60_000).toLocaleString(undefined, {
                    weekday: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
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
          </View>
        </View>
      </Modal>
    </Card>
  );
};
