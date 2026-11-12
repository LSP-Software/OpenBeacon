import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { trpc } from "../lib/api.ts";
import { storage } from "../lib/storage.ts";
import { Button } from "./ui/Button.tsx";
import { Text } from "./ui/Text.tsx";

const dismissedKey = (deviceId: string) => `newSignInBanner.dismissed.${deviceId}`;

export const NewSignInBanner = ({ subscribed }: { subscribed: boolean }) => {
  const devices = useQuery({ ...trpc.account.listDevices.queryOptions(), subscribed });
  const [, setRevision] = useState(0);
  const pending = devices.data?.find(
    (device) =>
      !device.activatedAt && !device.isCurrent && !storage.getBoolean(dismissedKey(device.id)),
  );
  if (!pending) return null;

  return (
    <View className="mb-2 gap-2 rounded-xl border border-primary bg-card p-4">
      <Text className="font-semibold text-foreground">
        New sign-in on {pending.name}. Is this you?
      </Text>
      <Text>
        It can’t see anyone’s location until you scan the code it shows. If it isn’t you, remove it
        and change your password.
      </Text>
      <View className="flex-row flex-wrap items-center gap-3">
        <Link href="/account/add-device" asChild>
          <Button size="sm">
            <Text>Yes, scan its code</Text>
          </Button>
        </Link>
        <Link
          href={{
            pathname: "/account/remove-device",
            params: { deviceId: pending.id, name: pending.name },
          }}
          asChild
        >
          <Button size="sm" variant="destructive">
            <Text>Not me</Text>
          </Button>
        </Link>
        <Button
          size="sm"
          variant="outline"
          onPress={() => {
            storage.set(dismissedKey(pending.id), true);
            setRevision((revision) => revision + 1);
          }}
        >
          <Text>Later</Text>
        </Button>
      </View>
    </View>
  );
};
