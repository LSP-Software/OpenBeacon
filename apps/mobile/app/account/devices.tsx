import { zodResolver } from "@hookform/resolvers/zod";
import { deviceIconSchema, deviceNameSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";
import { BackButton } from "../../components/headers/BackButton.tsx";
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
import { deviceIconFor } from "../../lib/deviceIcons.ts";
import { shortTimeSince } from "../../lib/timeSince.ts";

const schema = z.object({ name: deviceNameSchema, icon: deviceIconSchema });

const DevicesScreen = () => {
  const queryClient = useQueryClient();
  const devices = useQuery(trpc.account.listDevices.queryOptions());
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
      Alert.alert("Unable to update device", result.error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: trpc.account.listDevices.queryKey() });
    setEditing(null);
  };

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          <BackButton />
          <Text className="text-foreground text-2xl font-bold">Devices</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit device</DialogTitle>
          </DialogHeader>
          <Input control={form.control} name="name" label="Name" maxLength={40} />
          <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-3">
            {deviceIconSchema.options.map((icon) => {
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
                    selected ? "border-primary bg-primary/10" : "border-border bg-background",
                  )}
                >
                  <Icon
                    as={option.icon}
                    className={selected ? "text-primary size-6" : "text-muted-foreground size-6"}
                  />
                </Pressable>
              );
            })}
          </View>
          <Button onPress={form.handleSubmit(save)} loading={updateDevice.isPending}>
            <Text>Save</Text>
          </Button>
          {editing?.isCurrent ? (
            <Text className="text-muted-foreground text-sm leading-5">
              To remove this phone, sign out on the Account tab and choose to remove it.
            </Text>
          ) : (
            editing && (
              <Link
                href={{
                  pathname: "/account/remove-device",
                  params: { deviceId: editing.id, name: editing.name },
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
        </DialogContent>
      </Dialog>

      {devices.isPending ? (
        <LoadingIndicator />
      ) : devices.isError ? (
        <View className="flex-1 items-center justify-center gap-4 px-6">
          <Text className="text-muted-foreground text-center">
            We couldn’t load your devices. Check your connection and try again.
          </Text>
          <Button variant="outline" onPress={() => devices.refetch()}>
            <Text>Try again</Text>
          </Button>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-4 px-6 py-6 pb-32"
          showsVerticalScrollIndicator={false}
        >
          <Text className="text-muted-foreground text-base leading-6">
            Phones and tablets signed in to your account. Tap one to rename it, change its icon or
            remove it.
          </Text>
          <View className="overflow-hidden rounded-3xl border border-border bg-card">
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
                  accessibilityHint="Edit name and icon, or remove it"
                  className={cn(
                    "flex-row items-center gap-4 px-5 py-4",
                    index < devices.data.length - 1 && "border-b border-border/50",
                  )}
                  onPress={() => {
                    form.reset({ name: device.name, icon: device.icon });
                    setEditing(device);
                  }}
                >
                  <View className="size-11 items-center justify-center rounded-2xl border border-border bg-background/70">
                    <Icon
                      as={deviceIconFor(device.icon, device.platform).icon}
                      className="text-primary size-5"
                    />
                  </View>
                  <View className="flex-1 gap-1">
                    <View className="flex-row flex-wrap items-center gap-2">
                      <Text className="text-foreground text-base font-medium">{device.name}</Text>
                      {device.isCurrent && (
                        <View className="rounded-full bg-primary/10 px-2 py-0.5">
                          <Text className="text-primary text-xs font-medium">This phone</Text>
                        </View>
                      )}
                      {!device.activatedAt && (
                        <View className="rounded-full bg-muted px-2 py-0.5">
                          <Text className="text-muted-foreground text-xs font-medium">
                            Waiting for setup
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text className="text-muted-foreground text-sm">
                      {[
                        device.model,
                        `Added ${device.createdAt.toLocaleDateString(undefined, { dateStyle: "medium" })}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                    <Text className="text-muted-foreground text-sm">
                      {device.isCurrent || lastActive === "now"
                        ? "Active now"
                        : `Last active ${lastActive} ago`}
                    </Text>
                    <Text className="text-muted-foreground text-sm">
                      {!device.activatedAt
                        ? "Can’t see anyone’s location until it’s set up"
                        : groups.data?.length === 0
                          ? "Not sharing with any group"
                          : [
                              lastLocation === null
                                ? "No location shared yet"
                                : lastLocation === "now"
                                  ? "Location updated now"
                                  : `Location updated ${lastLocation} ago`,
                              position ? `Battery ${position.battery.level}%` : null,
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
            <Button variant="outline">
              <Text>Add a device</Text>
            </Button>
          </Link>
        </ScrollView>
      )}
    </View>
  );
};

export default DevicesScreen;
