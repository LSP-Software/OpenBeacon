import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { ChevronRightIcon } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ProfileImage } from "../../../components/image/ProfileImage";
import { Button } from "../../../components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/Card";
import { Text } from "../../../components/ui/Text.tsx";
import { authClient, SESSION_TOKEN_TO_REVOKE_KEY } from "../../../lib/auth-client";
import { getLocationPermissionWarningTitle } from "../../../lib/locationPermissions";
import { tryCatch } from "../../../lib/tryCatch";
import { useLocationPermissions } from "../../../providers/LocationPermissionProvider.tsx";

type SettingRowProps = {
  label: string;
  sublabel?: string;
  onPress: () => void;
};

const SettingRow = ({ label, sublabel, onPress }: SettingRowProps) => {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center justify-between gap-2 px-4 py-3 border-b border-border"
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View className="w-2 h-2 rounded-full bg-primary items-center" />
      <View className="flex-1 gap-1">
        <Text className="text-foreground font-medium">{label}</Text>
        {sublabel !== undefined && <Text className="text-muted text-sm">{sublabel}</Text>}
      </View>
      <ChevronRightIcon />
    </Pressable>
  );
};

const AccountScreen = () => {
  const { data: session } = authClient.useSession();
  const { openLocationPermissionSettings, permissionState } = useLocationPermissions();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const name = session?.user.name ?? "";
  const email = session?.user.email ?? "";

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    const sessionTokenToRevoke = session?.session?.token ?? null;

    const { error: signOutError } = await authClient.signOut();

    if (signOutError && sessionTokenToRevoke) {
      await tryCatch(SecureStore.setItemAsync(SESSION_TOKEN_TO_REVOKE_KEY, sessionTokenToRevoke));
    }

    setIsSigningOut(false);
    router.replace("/");
  };

  const locationPermissionWarningTitle = permissionState
    ? getLocationPermissionWarningTitle(permissionState)
    : "";

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="z-10">
        <View className="px-8 pt-4 pb-10">
          <Text className="text-muted uppercase font-bold">Your</Text>
          <Text className="text-foreground text-3xl font-bold">Account</Text>
        </View>
      </SafeAreaView>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 pb-28 gap-4"
        showsVerticalScrollIndicator={false}
      >
        <View className="items-center py-6 gap-4">
          <ProfileImage showEditButton />
          <View className="items-center gap-1">
            <Text className="text-foreground text-2xl font-bold">{name}</Text>
            <Text className="text-muted text-sm">{email}</Text>
          </View>
        </View>

        {permissionState?.shouldShowAccountWarning ? (
          <Card className="gap-4 py-0">
            <CardHeader className="px-5 pt-5">
              <CardTitle>{locationPermissionWarningTitle}</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 gap-4">
              <Text className="text-muted">
                OpenBeacon needs precise foreground and background location to share your location
                with your family. Location tracking won't be active without it.
              </Text>
              <Button variant="outline" onPress={openLocationPermissionSettings}>
                <Text>Open Settings</Text>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <View className="rounded-lg overflow-hidden border border-border bg-card">
          <SettingRow
            label="Profile details"
            sublabel="Name, email and account"
            onPress={() => {}}
          />
          <SettingRow
            label="Server Configuration"
            sublabel="Self-hosted or managed"
            onPress={() => router.push("/serverUrl")}
          />
        </View>

        <Button onPress={handleSignOut}>
          <Text>Sign out</Text>
        </Button>
        <Text className="text-muted text-sm text-center">OpenBeacon · Open Source</Text>
      </ScrollView>
    </View>
  );
};

export default AccountScreen;
