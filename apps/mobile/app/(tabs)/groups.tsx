import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useColors } from "../../lib/theme.ts";

function PlusIcon({ color, size }: { color: string; size: number }) {
  const thickness = Math.max(2, Math.round(size * 0.12));
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          position: "absolute",
          width: size,
          height: thickness,
          borderRadius: thickness / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: thickness,
          height: size,
          borderRadius: thickness / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

function ShieldIcon({ color, size }: { color: string; size: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: size * 0.7,
          height: size * 0.8,
          borderRadius: size * 0.18,
          borderTopLeftRadius: size * 0.28,
          borderTopRightRadius: size * 0.28,
          borderWidth: 2,
          borderColor: color,
          opacity: 0.7,
        }}
      />
    </View>
  );
}

export default function GroupsScreen() {
  const colors = useColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SafeAreaView edges={["top"]} style={styles.safeTop}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.headerSub, { color: colors.textMuted }]}>Your family</Text>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Groups</Text>
          </View>
          <Pressable
            style={[styles.addButton, { backgroundColor: colors.primary }]}
            accessibilityRole="button"
            accessibilityLabel="Create new group"
          >
            <PlusIcon color="#FFFFFF" size={16} />
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.emptyState}>
          <View
            style={[
              styles.emptyIconWrap,
              { backgroundColor: colors.primaryDim, borderColor: colors.border },
            ]}
          >
            <ShieldIcon color={colors.primary} size={40} />
          </View>
          <View style={styles.emptyTextBlock}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No groups yet</Text>
            <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
              Groups keep your family connected. Create one to start sharing locations privately
              — only members of your group can see each other.
            </Text>
          </View>
          <Pressable
            style={[styles.createBtn, { backgroundColor: colors.primary }]}
            accessibilityRole="button"
            accessibilityLabel="Create your first group"
          >
            <Text style={[styles.createBtnText, { color: colors.onPrimary }]}>
              Create a Group
            </Text>
          </Pressable>
        </View>

        <View
          style={[styles.privacyNote, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={[styles.privacyDot, { backgroundColor: colors.primary }]} />
          <Text style={[styles.privacyText, { color: colors.textSecondary }]}>
            Location data is encrypted end-to-end. The server never stores your plaintext
            location.
          </Text>
        </View>
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 120,
    gap: 16,
  },
  emptyState: {
    alignItems: "center",
    paddingTop: 40,
    gap: 24,
  },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTextBlock: {
    alignItems: "center",
    gap: 10,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 300,
  },
  createBtn: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 14,
  },
  createBtnText: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  privacyNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 16,
  },
  privacyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 5,
    flexShrink: 0,
  },
  privacyText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 0.1,
  },
});
