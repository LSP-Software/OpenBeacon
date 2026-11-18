import { router } from "expo-router";
import { ArrowLeftIcon } from "lucide-react-native";
import { Pressable } from "react-native";
import { Icon } from "../ui/Icon.tsx";

export const ReturnToHomeHeader = () => {
  return (
    <Pressable
      className="-ml-2.5 size-11 items-center justify-center rounded-full active:bg-secondary"
      onPress={() => router.push("/")}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <Icon as={ArrowLeftIcon} className="size-6 text-foreground" />
    </Pressable>
  );
};
