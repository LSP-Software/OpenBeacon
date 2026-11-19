import { KeyRoundIcon } from "lucide-react-native";
import { View } from "react-native";
import { readLostSessions } from "../lib/endSession.ts";
import { signInKeyNotice } from "../lib/keyRemovalWarnings.ts";
import { thisDeviceNoun } from "../lib/thisDeviceNoun.ts";
import { Icon } from "./ui/Icon.tsx";
import { Text } from "./ui/Text.tsx";

export const HeldKeysNotice = () => {
  const notice = signInKeyNotice({ held: readLostSessions(), noun: thisDeviceNoun() });
  if (!notice) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      className="flex-row gap-3 rounded-2xl border border-warning-accent bg-card p-4"
    >
      <Icon as={KeyRoundIcon} className="text-warning-text size-5" />
      <View className="flex-1 gap-1">
        <Text className="font-semibold text-warning-text">{notice.title}</Text>
        <Text className="text-secondary text-sm">{notice.message}</Text>
      </View>
    </View>
  );
};
