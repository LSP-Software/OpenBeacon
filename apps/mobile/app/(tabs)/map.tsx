import { StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button.tsx";
import { useColors } from "../../lib/theme.ts";

export default function MapScreen() {
  const colors = useColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.spacer} />
      <View style={styles.bottomArea}>
        <View
          style={[
            styles.noGroupCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.noGroupInner}>
            <View style={styles.noGroupText}>
              <Text style={[styles.noGroupTitle, { color: colors.text }]}>
                No active group
              </Text>
              <Text style={[styles.noGroupSub, { color: colors.textMuted }]}>
                Create or join a group to see family locations on the map
              </Text>
            </View>
            <Button title="View Groups" variant="secondary" onPress={() => {}} />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  spacer: {
    flex: 1,
  },
  bottomArea: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  noGroupCard: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
  },
  noGroupInner: {
    padding: 20,
    gap: 16,
  },
  noGroupText: {
    gap: 6,
  },
  noGroupTitle: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  noGroupSub: {
    fontSize: 13,
    lineHeight: 19,
  },
});
