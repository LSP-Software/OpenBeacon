import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { ChevronRightIcon } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../../components/Button.tsx";
import { authClient, SESSION_TOKEN_TO_REVOKE_KEY } from "../../lib/auth-client.ts";

type SettingRowProps = {
  label: string;
  sublabel?: string;
  onPress: () => void;
};

function SettingRow({ label, sublabel, onPress }: SettingRowProps) {
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
}

export default function AccountScreen() {
  const { data: session } = authClient.useSession();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const name = session?.user.name ?? "";
  const email = session?.user.email ?? "";
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    const sessionTokenToRevoke = session?.session?.token ?? null;
    try {
      const result = await authClient.signOut();
      if (result?.error && sessionTokenToRevoke) {
        await SecureStore.setItemAsync(SESSION_TOKEN_TO_REVOKE_KEY, sessionTokenToRevoke);
      }
    } catch {
      if (sessionTokenToRevoke) {
        await SecureStore.setItemAsync(SESSION_TOKEN_TO_REVOKE_KEY, sessionTokenToRevoke);
      }
    } finally {
      setIsSigningOut(false);
      router.replace("/");
    }
  };

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
          <View className="w-20 h-20 rounded-full bg-primary items-center justify-center">
            <Text className="text-on-primary text-2xl font-bold">{initials}</Text>
          </View>
          <View className="items-center gap-1">
            <Text className="text-foreground text-2xl font-bold">{name}</Text>
            <Text className="text-muted text-sm">{email}</Text>
          </View>
        </View>

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

        <Button title="Sign out" onPress={handleSignOut} variant="primary" />
        <Text className="text-muted text-sm text-center">OpenBeacon · Open Source</Text>
      </ScrollView>
    </View>
  );
}
