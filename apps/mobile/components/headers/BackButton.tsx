import { type Href, router } from "expo-router";
import { ArrowLeftIcon } from "lucide-react-native";
import { Pressable } from "react-native";
import { Icon } from "../ui/Icon.tsx";

export const BackButton = ({ fallback }: { fallback?: Href }) => {
  return (
    <Pressable
      className="size-11 items-center justify-center rounded-full active:bg-secondary"
      onPress={() => (fallback && !router.canGoBack() ? router.replace(fallback) : router.back())}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <Icon as={ArrowLeftIcon} className="size-6 text-foreground" />
    </Pressable>
  );
};
