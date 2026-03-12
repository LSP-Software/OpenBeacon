import { Image } from "expo-image";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useProfilePictureUpload } from "../../hooks/useProfilePictureUpload.ts";
import { authClient, SESSION_TOKEN_TO_REVOKE_KEY } from "../../lib/auth-client.ts";
import { useColors } from "../../lib/theme.ts";

function ChevronRight({ color }: { color: string }) {
  return (
    <View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: 7,
          height: 7,
          borderRightWidth: 2,
          borderTopWidth: 2,
          borderColor: color,
          transform: [{ rotate: "45deg" }],
        }}
      />
    </View>
  );
}

function PencilIcon({ color, size }: { color: string; size: number }) {
  const strokeWidth = size * 0.15;
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: "absolute",
          width: size * 0.6,
          height: size * 0.35,
          borderWidth: strokeWidth,
          borderColor: color,
          borderRadius: strokeWidth,
          transform: [{ rotate: "-45deg" }],
          top: size * 0.15,
          left: size * 0.2,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: 0,
          height: 0,
          borderLeftWidth: strokeWidth * 1.2,
          borderRightWidth: strokeWidth * 1.2,
          borderTopWidth: size * 0.2,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderTopColor: color,
          transform: [{ rotate: "-45deg" }],
          bottom: size * 0.12,
          left: size * 0.08,
        }}
      />
    </View>
  );
}

type SettingRowProps = {
  label: string;
  sublabel?: string;
  accentColor: string;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
};

function SettingRow({ label, sublabel, accentColor, onPress, colors }: SettingRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingRow,
        { borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[styles.settingAccent, { backgroundColor: accentColor }]} />
      <View style={styles.settingText}>
        <Text style={[styles.settingLabel, { color: colors.text }]}>{label}</Text>
        {sublabel !== undefined && (
          <Text style={[styles.settingSublabel, { color: colors.textMuted }]}>{sublabel}</Text>
        )}
      </View>
      <ChevronRight color={colors.textMuted} />
    </Pressable>
  );
}

export default function AccountScreen() {
  const colors = useColors();
  const { data: session } = authClient.useSession();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [localImageUrl, setLocalImageUrl] = useState<string | null>(null);
  const profilePicture = useProfilePictureUpload();

  const name = session?.user.name ?? "";
  const email = session?.user.email ?? "";
  const imageUrl = localImageUrl ?? session?.user.image ?? null;

  const handleEditProfilePicture = () => {
    profilePicture.mutate(undefined, {
      onSuccess: (url) => setLocalImageUrl(url),
      onError: (error) => {
        if (error.message?.includes("cancel")) return;
        Alert.alert("Upload Failed", error.message);
      },
    });
  };

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
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SafeAreaView edges={["top"]} style={styles.safeTop}>
        <View style={styles.header}>
          <Text style={[styles.headerSub, { color: colors.textMuted }]}>Your</Text>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Account</Text>
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileSection}>
          <View style={styles.avatarContainer}>
            <View style={[styles.avatar, { backgroundColor: colors.border }]}>
              {imageUrl ? (
                <Image
                  source={{ uri: imageUrl }}
                  style={styles.avatarImage}
                  cachePolicy="disk"
                  transition={200}
                />
              ) : null}
              {profilePicture.isPending && (
                <View style={styles.avatarOverlay}>
                  <ActivityIndicator color={colors.onPrimary} />
                </View>
              )}
            </View>
            <Pressable
              onPress={handleEditProfilePicture}
              disabled={profilePicture.isPending}
              style={({ pressed }) => [
                styles.editButton,
                {
                  backgroundColor: colors.primary,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Edit profile picture"
            >
              <PencilIcon color={colors.onPrimary} size={14} />
            </Pressable>
          </View>
          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, { color: colors.text }]}>{name}</Text>
            <Text style={[styles.profileEmail, { color: colors.textSecondary }]}>{email}</Text>
          </View>
        </View>

        <View
          style={[
            styles.settingsCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <SettingRow
            label="Profile details"
            sublabel="Name, email and account"
            accentColor={colors.primary}
            onPress={() => {}}
            colors={colors}
          />
          <SettingRow
            label="Server Configuration"
            sublabel="Self-hosted or managed"
            accentColor="#1ABCFE"
            onPress={() => router.push("/serverUrl")}
            colors={colors}
          />
        </View>

        <Pressable
          onPress={handleSignOut}
          disabled={isSigningOut}
          style={({ pressed }) => [
            styles.signOutBtn,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              opacity: isSigningOut ? 0.6 : pressed ? 0.65 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={isSigningOut ? "Signing out" : "Sign out"}
        >
          <Text style={[styles.signOutText, { color: colors.primary }]}>
            {isSigningOut ? "Signing out…" : "Sign Out"}
          </Text>
        </Pressable>

        <Text style={[styles.buildLabel, { color: colors.textMuted }]}>
          OpenBeacon · Open Source
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeTop: {
    zIndex: 10,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 20,
  },
  headerSub: {
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    fontWeight: "500",
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 120,
    gap: 14,
  },
  profileSection: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 14,
  },
  avatarContainer: {
    position: "relative" as const,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
  },
  avatarImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  editButton: {
    position: "absolute" as const,
    bottom: 0,
    right: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  profileInfo: {
    alignItems: "center",
    gap: 4,
  },
  profileName: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  profileEmail: {
    fontSize: 13,
    letterSpacing: 0.1,
  },
  settingsCard: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingAccent: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  settingText: {
    flex: 1,
    gap: 2,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: "500",
    letterSpacing: -0.1,
  },
  settingSublabel: {
    fontSize: 11,
    letterSpacing: 0.1,
  },
  signOutBtn: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 6,
  },
  signOutText: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  buildLabel: {
    fontSize: 11,
    letterSpacing: 0.5,
    textAlign: "center",
    paddingVertical: 4,
  },
});
