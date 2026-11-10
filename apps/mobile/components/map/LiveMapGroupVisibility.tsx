import { EyeOffIcon } from "lucide-react-native";
import { Pressable, ScrollView, View } from "react-native";
import type { MapGroupOption } from "../../lib/mapPeopleTypes.ts";
import { Icon } from "../ui/Icon.tsx";
import { Switch } from "../ui/Switch.tsx";
import { Text } from "../ui/Text.tsx";

export const LiveMapGroupMenu = ({
  groups,
  maxHeight,
  onSetHidden,
}: {
  groups: readonly MapGroupOption[];
  maxHeight: number;
  onSetHidden: (groupId: string, hidden: boolean) => void;
}) => (
  <View
    accessibilityLabel="Show on map"
    className="absolute right-16 top-14 w-64 rounded-2xl border border-border bg-card py-1.5 shadow-md shadow-black/20"
    style={{ maxHeight }}
  >
    <Text className="mx-4 mb-1 mt-1.5 text-[11px] font-bold uppercase text-muted dark:text-muted-foreground">
      Show on map
    </Text>
    <ScrollView className="grow-0">
      {groups.map((group) => (
        <Pressable
          key={group.id}
          accessible={false}
          className="flex-row items-center gap-3 px-4 py-2 active:opacity-70"
          onPress={() => onSetHidden(group.id, !group.hidden)}
        >
          <View
            className={
              group.hidden
                ? "size-3 rounded-full border-[1.5px] border-muted dark:border-muted-foreground"
                : "size-3 rounded-full"
            }
            style={group.hidden ? undefined : { backgroundColor: group.color }}
          />
          <View className="min-w-0 flex-1">
            <Text
              className={
                group.hidden
                  ? "font-semibold text-muted dark:text-muted-foreground"
                  : "font-semibold text-foreground"
              }
              numberOfLines={1}
            >
              {group.name}
            </Text>
            <Text className="text-xs text-muted dark:text-muted-foreground">
              {group.memberCount} {group.memberCount === 1 ? "person" : "people"}
            </Text>
          </View>
          <Switch
            accessibilityLabel={`Show ${group.name} on the map`}
            value={!group.hidden}
            onValueChange={(shown) => onSetHidden(group.id, !shown)}
          />
        </Pressable>
      ))}
    </ScrollView>
    <Text className="mx-4 mb-1.5 mt-1 border-t border-border pt-2.5 text-xs text-muted dark:text-muted-foreground">
      Only changes this phone. You still share your location with hidden groups.
    </Text>
  </View>
);

export const LiveMapHiddenGroupsNotice = ({
  bottom,
  groups,
  onOpenMenu,
  onUndo,
  toastGroupNames,
}: {
  bottom: number;
  groups: readonly MapGroupOption[];
  onOpenMenu: () => void;
  onUndo: () => void;
  toastGroupNames: readonly string[];
}) => {
  const [onlyToastGroupName] = toastGroupNames;
  if (onlyToastGroupName !== undefined) {
    const toastSubject =
      toastGroupNames.length === 1 ? onlyToastGroupName : `${toastGroupNames.length} groups`;
    return (
      <View
        accessibilityLiveRegion="polite"
        className="absolute left-3 right-3 flex-row items-center gap-3 rounded-xl bg-foreground py-2.5 pl-4 pr-2 shadow-md shadow-black/25"
        style={{ bottom }}
      >
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-semibold text-background" numberOfLines={1}>
            {toastSubject} hidden
          </Text>
          <Text className="text-xs text-background opacity-75">
            You’re still sharing your location with them.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Undo, show ${toastSubject}`}
          className="min-h-11 justify-center px-3 active:opacity-70"
          onPress={onUndo}
        >
          <Text className="font-bold text-background underline">Undo</Text>
        </Pressable>
      </View>
    );
  }

  const hiddenGroups = groups.filter((group) => group.hidden);
  const [onlyGroup] = hiddenGroups;
  if (!onlyGroup) return null;

  return (
    <View
      pointerEvents="box-none"
      className="absolute left-0 right-0 items-center px-4"
      style={{ bottom }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens the list of groups shown on the map"
        className="max-w-full flex-row items-center gap-1.5 rounded-full border border-border bg-card py-2 pl-2.5 pr-3 shadow-sm shadow-black/15 active:opacity-70"
        onPress={onOpenMenu}
      >
        <Icon as={EyeOffIcon} size={15} className="text-muted dark:text-muted-foreground" />
        <View className="flex-row">
          {hiddenGroups.map((group, index) => (
            <View
              key={group.id}
              className="size-2.5 rounded-full border border-card"
              style={{ backgroundColor: group.color, marginLeft: index === 0 ? 0 : -3 }}
            />
          ))}
        </View>
        <Text className="shrink text-[13px] font-semibold text-foreground" numberOfLines={1}>
          {hiddenGroups.length === 1
            ? `${onlyGroup.name} hidden`
            : hiddenGroups.length === groups.length
              ? "All groups hidden"
              : `${hiddenGroups.length} groups hidden`}
        </Text>
      </Pressable>
    </View>
  );
};
