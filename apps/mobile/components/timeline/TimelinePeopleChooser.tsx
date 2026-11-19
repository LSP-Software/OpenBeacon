import { CheckIcon } from "lucide-react-native";
import { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cn } from "../../lib/cn.ts";
import { MAX_TIMELINE_POINTS } from "../../lib/timelineBudget.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

export const TimelinePeopleChooser = ({
  onApply,
  onClose,
  open,
  people,
  shown,
}: {
  onApply: (userIds: string[]) => void;
  onClose: () => void;
  open: boolean;
  people: ReadonlyArray<{ color: string; name: string; points: number; userId: string }>;
  shown: readonly string[];
}) => {
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<readonly string[]>(shown);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPicked(shown);
  }

  const total = people
    .filter((person) => picked.includes(person.userId))
    .reduce((sum, person) => sum + person.points, 0);
  const pickedCount = people.filter((person) => picked.includes(person.userId)).length;

  return (
    <Modal transparent visible={open} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/50">
        <Pressable
          className="absolute inset-0"
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
        />
        <View
          accessibilityViewIsModal
          className="max-h-[85%] gap-4 rounded-t-3xl bg-card px-6 pt-5"
          style={{ paddingBottom: Math.max(insets.bottom, 20) }}
        >
          <View className="flex-row items-center justify-between gap-3">
            <Text accessibilityRole="header" className="flex-1 text-xl font-semibold">
              Choose people
            </Text>
            <Button size="sm" variant="ghost" onPress={onClose}>
              <Text>Cancel</Text>
            </Button>
          </View>
          <Text className="text-sm text-tertiary">
            This {thisDeviceNoun()} can decrypt and play about{" "}
            {MAX_TIMELINE_POINTS.toLocaleString()} locations at once. Pick who to show on this day.
          </Text>
          <ScrollView contentContainerClassName="gap-1" style={{ flexShrink: 1 }}>
            {people.map((person) => {
              const checked = picked.includes(person.userId);
              const tooMany = !checked && total + person.points > MAX_TIMELINE_POINTS;
              return (
                <Pressable
                  key={person.userId}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked, disabled: tooMany }}
                  accessibilityHint={tooMany ? "Untick someone else first" : undefined}
                  disabled={tooMany}
                  onPress={() =>
                    setPicked((current) =>
                      checked
                        ? current.filter((userId) => userId !== person.userId)
                        : [...current, person.userId],
                    )
                  }
                  className={cn(
                    "min-h-14 flex-row items-center gap-3 rounded-xl px-2",
                    tooMany && "opacity-50",
                  )}
                >
                  <View
                    className={cn(
                      "size-6 items-center justify-center rounded-md border-2",
                      checked ? "border-primary bg-primary" : "border-border",
                    )}
                  >
                    {checked ? <Icon as={CheckIcon} size={16} className="text-white" /> : null}
                  </View>
                  <View className="size-3 rounded-full" style={{ backgroundColor: person.color }} />
                  <View className="flex-1">
                    <Text className="font-semibold text-foreground" numberOfLines={1}>
                      {person.name}
                    </Text>
                    <Text className="text-xs text-secondary">
                      {tooMany
                        ? "Too many locations to add. Untick someone else first."
                        : `About ${person.points.toLocaleString()} ${person.points === 1 ? "location" : "locations"}`}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          <Button
            disabled={pickedCount === 0}
            onPress={() =>
              onApply(
                people
                  .filter((person) => picked.includes(person.userId))
                  .map((person) => person.userId),
              )
            }
          >
            <Text>Show</Text>
          </Button>
        </View>
      </View>
    </Modal>
  );
};
