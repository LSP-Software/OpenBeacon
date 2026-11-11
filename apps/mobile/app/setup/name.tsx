import { zodResolver } from "@hookform/resolvers/zod";
import { deviceIconSchema, deviceNameSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useFocusEffect } from "expo-router";
import { useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { BackHandler, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Input } from "../../components/ui/Input.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { Alert } from "../../lib/alert.ts";
import { trpc } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { deviceIcons } from "../../lib/deviceIcons.ts";
import { requestTrackingSync } from "../../lib/trackingEvents.ts";

const schema = z.object({ name: deviceNameSchema, icon: deviceIconSchema });

const finish = () => {
  requestTrackingSync();
  router.replace("/");
};

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

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
      return () => subscription.remove();
    }, []),
  );

  useEffect(() => {
    if (thisPhone) form.reset({ name: thisPhone.name, icon: thisPhone.icon });
  }, [thisPhone?.id]);

  const save = async ({ name, icon }: z.infer<typeof schema>) => {
    if (!thisPhone) {
      finish();
      return;
    }
    const result = await tryCatch(updateDevice.mutateAsync({ deviceId: thisPhone.id, name, icon }));
    if (result.error) {
      Alert.alert("Unable to save the name", result.error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: trpc.account.listDevices.queryKey() });
    finish();
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <Stack.Screen options={{ gestureEnabled: false }} />
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-6 py-6 pb-16"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-4">
          <Text className="text-foreground text-3xl font-bold">Name this phone</Text>
          <Text className="text-muted-foreground text-base leading-6">
            This phone is set up. Its name and icon help you tell your devices apart on the map and
            in Account → Devices.
          </Text>
        </View>
        {devices.isPending ? (
          <LoadingIndicator />
        ) : devices.isError ? (
          <View className="gap-4">
            <Text className="text-muted-foreground text-base leading-6">
              We couldn’t load this phone’s details. Check your connection and try again, or skip
              and name it later in Account → Devices.
            </Text>
            <Button variant="outline" onPress={() => devices.refetch()}>
              <Text>Try again</Text>
            </Button>
          </View>
        ) : (
          <View className="gap-4">
            <Input control={form.control} name="name" label="Name" maxLength={40} />
            <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-3">
              {deviceIconSchema.options.map((icon) => {
                const selected = selectedIcon === icon;
                return (
                  <Pressable
                    key={icon}
                    accessibilityRole="radio"
                    accessibilityLabel={deviceIcons[icon].label}
                    accessibilityState={{ checked: selected }}
                    onPress={() => form.setValue("icon", icon)}
                    className={cn(
                      "size-12 items-center justify-center rounded-2xl border",
                      selected ? "border-primary bg-primary/10" : "border-border bg-background",
                    )}
                  >
                    <Icon
                      as={deviceIcons[icon].icon}
                      className={selected ? "text-primary size-6" : "text-muted-foreground size-6"}
                    />
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
        {!devices.isError && (
          <Button onPress={form.handleSubmit(save)} loading={updateDevice.isPending}>
            <Text>Continue</Text>
          </Button>
        )}
        <Button variant="ghost" onPress={finish} disabled={updateDevice.isPending}>
          <Text>Skip</Text>
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
};

export default NameThisPhoneScreen;
