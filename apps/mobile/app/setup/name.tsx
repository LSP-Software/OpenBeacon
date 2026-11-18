import { zodResolver } from "@hookform/resolvers/zod";
import { deviceIconSchema, deviceNameSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef } from "react";
import { useForm } from "react-hook-form";
import { Platform, Pressable, View } from "react-native";
import { z } from "zod";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import {
  OnboardingScreen,
  useAdvanceOnboardingOnce,
} from "../../components/onboarding/OnboardingScreen.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Input } from "../../components/ui/Input.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { Alert } from "../../lib/alert.ts";
import { trpc } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { deviceIconFor, selectableDeviceIcons } from "../../lib/deviceIcons.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";
import { requestTrackingSync } from "../../lib/trackingEvents.ts";
import { userMessage } from "../../lib/userMessage.ts";

const schema = z.object({ name: deviceNameSchema, icon: deviceIconSchema });

const NameThisPhoneScreen = () => {
  const queryClient = useQueryClient();
  const devices = useQuery(trpc.account.listDevices.queryOptions());
  const updateDevice = useMutation(trpc.account.updateDevice.mutationOptions());
  const thisPhone = devices.data?.find((device) => device.isCurrent);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", icon: "phone" },
  });
  const selectedIcon = form.watch("icon");
  const noun = thisDeviceNoun();
  const advance = useAdvanceOnboardingOnce();
  const saving = useRef(false);

  const finish = () => {
    requestTrackingSync();
    advance("name");
  };

  const thisPhoneId = thisPhone?.id;
  const resetToThisPhone = useEffectEvent(() => {
    if (thisPhone) form.reset({ name: thisPhone.name, icon: thisPhone.icon });
  });

  useEffect(() => {
    if (thisPhoneId) resetToThisPhone();
  }, [thisPhoneId]);

  const save = async ({ name, icon }: z.infer<typeof schema>) => {
    if (!thisPhone) {
      finish();
      return;
    }
    if (saving.current) return;
    saving.current = true;
    const result = await tryCatch(updateDevice.mutateAsync({ deviceId: thisPhone.id, name, icon }));
    saving.current = false;
    if (result.error) {
      Alert.alert("Unable to save the name", userMessage(result.error));
      return;
    }
    await queryClient.invalidateQueries({
      queryKey: trpc.account.listDevices.queryKey(),
    });
    finish();
  };

  const otherDevice = devices.data?.find((device) => !device.isCurrent && device.activatedAt);
  const previewName = form.watch("name").trim() || thisPhone?.name || `This ${noun}`;

  return (
    <OnboardingScreen
      step="name"
      title={`Name this ${noun}`}
      description="Its name and icon help you tell your devices apart in Account → Devices."
      primary={
        devices.isError && !devices.data
          ? { label: "Try again", onPress: () => void devices.refetch() }
          : {
              label: "Continue",
              onPress: form.handleSubmit(save),
              loading: updateDevice.isPending,
              disabled: devices.isPending,
            }
      }
      secondary={{
        label: "Skip",
        onPress: finish,
        disabled: updateDevice.isPending,
      }}
    >
      {devices.isPending ? (
        <LoadingIndicator />
      ) : devices.isError && !devices.data ? (
        <Text className="text-secondary text-base">
          We couldn’t load this {noun}’s details. Check your connection and try again, or skip and
          name it later in Account → Devices.
        </Text>
      ) : (
        <View className="gap-6">
          <View
            className="overflow-hidden rounded-2xl border border-border bg-card"
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            <View
              className={cn(
                "flex-row items-center gap-4 px-5 py-4",
                otherDevice && "border-b border-border/50",
              )}
            >
              <View className="size-11 items-center justify-center rounded-2xl border border-border bg-background/70">
                <Icon
                  as={deviceIconFor(selectedIcon, Platform.OS).icon}
                  className="text-primary size-5"
                />
              </View>
              <View className="flex-1 flex-row flex-wrap items-center gap-2">
                <Text className="text-foreground text-base font-medium">{previewName}</Text>
                <View className="rounded-full bg-primary-soft px-2 py-0.5">
                  <Text className="text-primary-text text-xs font-medium">This {noun}</Text>
                </View>
              </View>
            </View>
            {otherDevice && (
              <View className="flex-row items-center gap-4 px-5 py-4 opacity-70">
                <View className="size-11 items-center justify-center rounded-2xl border border-border bg-background/70">
                  <Icon
                    as={deviceIconFor(otherDevice.icon, otherDevice.platform).icon}
                    className="text-primary size-5"
                  />
                </View>
                <Text className="text-foreground flex-1 text-base font-medium">
                  {otherDevice.name}
                </Text>
              </View>
            )}
          </View>
          <Input control={form.control} name="name" label="Name" maxLength={40} />
          <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-3">
            {selectableDeviceIcons.map((icon) => {
              const selected = selectedIcon === icon;
              return (
                <Pressable
                  key={icon}
                  accessibilityRole="radio"
                  accessibilityLabel={deviceIconFor(icon, Platform.OS).label}
                  accessibilityState={{ checked: selected }}
                  onPress={() => form.setValue("icon", icon)}
                  className={cn(
                    "size-12 items-center justify-center rounded-2xl border",
                    selected ? "border-primary bg-primary-soft" : "border-border bg-background",
                  )}
                >
                  <Icon
                    as={deviceIconFor(icon, Platform.OS).icon}
                    className={selected ? "text-primary size-6" : "text-tertiary size-6"}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </OnboardingScreen>
  );
};

export default NameThisPhoneScreen;
