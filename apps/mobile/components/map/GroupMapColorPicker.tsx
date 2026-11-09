import { useMutation, useQuery } from "@tanstack/react-query";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useGroupColorRevision } from "../../hooks/useGroupColorRevision.ts";
import { Alert } from "../../lib/alert.ts";
import { authClient } from "../../lib/auth-client.ts";
import { GROUP_COLOR_NAMES, GROUP_COLOR_PALETTE, getGroupColor } from "../../lib/groupColor.ts";
import { groupColorSyncQueryOptions, saveGroupColor } from "../../lib/groupColorSync.ts";
import { Button } from "../ui/Button.tsx";
import { Text } from "../ui/Text.tsx";

export const GroupMapColorPicker = ({ groupId }: { groupId: string }) => {
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;
  useGroupColorRevision();
  const sync = useQuery(groupColorSyncQueryOptions(userId));
  const save = useMutation({
    mutationFn: saveGroupColor,
    onError: (error) => Alert.alert("Unable to save color", error.message),
  });
  const locked = !userId || !sync.isSuccess || sync.isFetching || save.isPending;
  const selectedColor = save.isPending ? save.variables.color : getGroupColor(groupId);

  return (
    <View className="gap-3 rounded-lg border border-border bg-card p-4">
      <View className="gap-1">
        <Text className="text-foreground font-medium">Map marker color</Text>
        <Text className="text-muted-foreground text-sm">
          Used for this group's ring on the live map. Only you see this color.
        </Text>
      </View>
      {sync.isError ? (
        <View className="gap-2">
          <Text className="text-destructive text-sm">Couldn't load your saved color.</Text>
          <Button variant="outline" onPress={() => sync.refetch()}>
            <Text>Try again</Text>
          </Button>
        </View>
      ) : (
        <View>
          <View className="flex-row flex-wrap gap-3" style={{ opacity: locked ? 0.5 : 1 }}>
            {GROUP_COLOR_PALETTE.map((color) => {
              const selected = selectedColor === color;

              return (
                <Pressable
                  key={color}
                  accessibilityRole="button"
                  accessibilityLabel={GROUP_COLOR_NAMES[color]}
                  accessibilityState={{ selected, disabled: locked }}
                  disabled={locked}
                  onPress={() => {
                    if (userId) save.mutate({ userId, groupId, color });
                  }}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: color,
                    borderWidth: selected ? 3 : 1,
                    borderColor: selected ? "#1A1025" : "#FFFFFF",
                  }}
                >
                  {save.isPending && selected && <ActivityIndicator size="small" color="#FFFFFF" />}
                </Pressable>
              );
            })}
          </View>
          {sync.isFetching && (
            <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
              <ActivityIndicator className="text-primary" />
            </View>
          )}
        </View>
      )}
    </View>
  );
};
