import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { authClient, SESSION_TOKEN_TO_REVOKE_KEY } from "../../lib/auth-client.ts";
import { useColors } from "../../lib/theme.ts";

const EXPO_AUTH_COOKIE_KEY = "openbeacon_cookie";

function getSessionTokenFromCookieStore(): string | null {
  try {
    const raw = SecureStore.getItem(EXPO_AUTH_COOKIE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, { value: string; expires?: string | null }>;
    const entry = Object.entries(parsed).find(([key]) => key.includes("session_token"));
    return entry?.[1]?.value ?? null;
  } catch {
    return null;
  }
}

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

  const name = session?.user.name ?? "";
  const email = session?.user.email ?? "";
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  const handleSignOut = async () => {
    const sessionTokenToRevoke = getSessionTokenFromCookieStore();
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
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={[styles.avatarText, { color: colors.onPrimary }]}>{initials}</Text>
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
          style={({ pressed }) => [
            styles.signOutBtn,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              opacity: pressed ? 0.65 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text style={[styles.signOutText, { color: colors.primary }]}>Sign Out</Text>
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
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 1,
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
  sectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
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
