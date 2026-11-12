import { type Href, router } from "expo-router";
import { ArrowLeftIcon } from "lucide-react-native";
import { Pressable } from "react-native";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";

export const BackButton = ({ fallback }: { fallback?: Href }) => {
  return (
    <Pressable
      className="flex flex-row items-center gap-1"
      onPress={() => (fallback && !router.canGoBack() ? router.replace(fallback) : router.back())}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <Icon as={ArrowLeftIcon} className="text-primary" />
      <Text className="text-primary">Back</Text>
    </Pressable>
  );
};
