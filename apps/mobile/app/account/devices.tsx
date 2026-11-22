import { zodResolver } from "@hookform/resolvers/zod";
import { deviceIconSchema, deviceNameSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Pressable, ScrollView, View } from "react-native";
import { z } from "zod";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { LocationSharingCard } from "../../components/LocationSharingCard.tsx";
import { isSharingPaused } from "@openbeacon/shared";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/Dialog.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Input } from "../../components/ui/Input.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useLiveTrackingPositions } from "../../hooks/useLiveTrackingPositions.ts";
import { Alert } from "../../lib/alert.ts";
import { type RouterOutputs, trpc } from "../../lib/api.ts";
import { authClient } from "../../lib/auth-client.ts";
import { cn } from "../../lib/cn.ts";
import { serverNow } from "../../lib/locationSharing.ts";
import { deviceIconFor, selectableDeviceIcons } from "../../lib/deviceIcons.ts";
import { shortTimeSince } from "../../lib/timeSince.ts";
import { userMessage } from "../../lib/userMessage.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

const schema = z.object({ name: deviceNameSchema, icon: deviceIconSchema });

const DevicesScreen = () => {
  const queryClient = useQueryClient();
  const devices = useQuery(trpc.account.listDevices.queryOptions());
  const sharing = useQuery(trpc.account.locationSharing.queryOptions());
  const { data: session } = authClient.useSession();
  const groups = useQuery(trpc.groupMembership.list.queryOptions());
  const { positions } = useLiveTrackingPositions();
  const updateDevice = useMutation(trpc.account.updateDevice.mutationOptions());
  const [editing, setEditing] = useState<RouterOutputs["account"]["listDevices"][number] | null>(
    null,
  );
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", icon: "phone" },
  });
  const selectedIcon = form.watch("icon");

  const save = async ({ name, icon }: z.infer<typeof schema>) => {
    if (!editing) return;
    const result = await tryCatch(updateDevice.mutateAsync({ deviceId: editing.id, name, icon }));
    if (result.error) {
      Alert.alert("Couldn’t update device", userMessage(result.error));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: trpc.account.listDevices.queryKey() });
    void queryClient.invalidateQueries({
      queryKey: trpc.groupMembership.listMemberDevices.pathKey(),
    });
    setEditing(null);
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Devices" />

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90%]">
          <ScrollView
            style={{ flexShrink: 1 }}
            contentContainerClassName="gap-4"
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <DialogHeader>
              <DialogTitle>Edit device</DialogTitle>
            </DialogHeader>
            <Input control={form.control} name="name" label="Name" maxLength={40} />
            <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-3">
              {selectableDeviceIcons.map((icon) => {
                const selected = selectedIcon === icon;
                const option = deviceIconFor(icon, editing?.platform);
                return (
                  <Pressable
                    key={icon}
                    accessibilityRole="radio"
                    accessibilityLabel={option.label}
                    accessibilityState={{ checked: selected }}
                    onPress={() => form.setValue("icon", icon)}
                    className={cn(
                      "size-12 items-center justify-center rounded-2xl border",
                      selected ? "border-primary bg-primary-soft" : "border-border bg-background",
                    )}
                  >
                    <Icon
                      as={option.icon}
                      className={selected ? "text-primary size-6" : "text-tertiary size-6"}
                    />
                  </Pressable>
                );
              })}
            </View>
            <Button onPress={form.handleSubmit(save)} loading={updateDevice.isPending}>
              <Text>Save</Text>
            </Button>
            {editing?.activatedAt ? (
              <LocationSharingCard
                device={devices.data?.find((device) => device.id === editing.id) ?? editing}
              />
            ) : null}
            {editing?.isCurrent ? (
              <Text className="text-tertiary text-sm leading-5">
                To remove this {thisDeviceNoun()}, sign out on the Account tab and choose to remove
                it.
              </Text>
            ) : (
              editing && (
                <Link
                  href={{
                    pathname: "/account/remove-device",
                    params: { deviceId: editing.id },
                  }}
                  onPress={() => setEditing(null)}
                  asChild
                >
                  <Button variant="destructive">
                    <Text>Remove device</Text>
                  </Button>
                </Link>
              )
            )}
          </ScrollView>
        </DialogContent>
      </Dialog>

      {devices.isPending ? (
        <LoadingIndicator />
      ) : devices.isError && !devices.data ? (
        <View className="flex-1 items-center justify-center gap-4 px-6">
          <Text className="text-tertiary text-center">
            We couldn’t load your devices. Check your connection and try again.
          </Text>
          <Button variant="secondary" onPress={() => devices.refetch()}>
            <Text>Try again</Text>
          </Button>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-6 px-4 pb-32 pt-2"
          showsVerticalScrollIndicator={false}
        >
          <Text className="text-secondary text-base">
            Phones and tablets signed in to your account. Tap one to manage location sharing, rename
            it, change its icon or remove it.
          </Text>
          <View className="overflow-hidden rounded-3xl bg-card">
            {devices.data.map((device, index) => {
              const lastActive = shortTimeSince(device.lastSeenAt);
              const position = positions.find(
                (item) => item.deviceId === device.id && item.userId === session?.user.id,
              );
              const lastLocationAt = position?.timestamp ?? device.lastLocationAt;
              const lastLocation = lastLocationAt ? shortTimeSince(lastLocationAt) : null;
              return (
                <Pressable
                  key={device.id}
                  accessibilityRole="button"
                  accessibilityHint="Manage location sharing, edit name and icon, or remove it"
                  className={cn(
                    "flex-row items-center gap-4 px-4 py-3.5 active:bg-secondary/60",
                    index < devices.data.length - 1 && "border-b border-border/60",
                  )}
                  onPress={() => {
                    form.reset({ name: device.name, icon: device.icon });
                    setEditing(device);
                  }}
                >
                  <View className="size-11 items-center justify-center rounded-xl bg-secondary">
                    <Icon
                      as={deviceIconFor(device.icon, device.platform).icon}
                      className="text-foreground size-5"
                    />
                  </View>
                  <View className="flex-1 gap-1">
                    <View className="flex-row flex-wrap items-center gap-2">
                      <Text className="text-foreground text-base font-semibold">{device.name}</Text>
                      {device.isCurrent && (
                        <View className="rounded-full bg-primary-soft px-2 py-0.5">
                          <Text className="text-primary-text text-xs font-medium">
                            This {thisDeviceNoun()}
                          </Text>
                        </View>
                      )}
                      {!device.activatedAt && (
                        <View className="rounded-full bg-secondary px-2 py-0.5">
                          <Text className="text-secondary text-xs font-medium">
                            Waiting for setup
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text className="text-tertiary text-sm">
                      {[
                        device.model,
                        `Added ${device.createdAt.toLocaleDateString(undefined, { dateStyle: "medium" })}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                    <Text className="text-tertiary text-sm">
                      {device.isCurrent || lastActive === "now"
                        ? "Active now"
                        : `Last active ${lastActive} ago`}
                    </Text>
                    <Text className="text-tertiary text-sm">
                      {!device.activatedAt
                        ? "Can’t see anyone’s location until it’s set up"
                        : isSharingPaused(device, serverNow()) ||
                            (sharing.data && isSharingPaused(sharing.data.account, serverNow()))
                          ? "Location sharing paused"
                          : groups.data?.length === 0
                            ? "Not sharing with any group"
                            : [
                                lastLocation === null
                                  ? "No location shared yet"
                                  : lastLocation === "now"
                                    ? "Location updated now"
                                    : `Location updated ${lastLocation} ago`,
                                position && position.battery.level !== null
                                  ? `Battery ${position.battery.level}%`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Link href="/account/add-device" asChild>
            <Button variant="secondary">
              <Text>Add a device</Text>
            </Button>
          </Link>
        </ScrollView>
      )}
    </View>
  );
};

export default DevicesScreen;
