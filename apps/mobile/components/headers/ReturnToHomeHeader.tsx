import { router } from "expo-router";
import { ArrowLeftIcon } from "lucide-react-native";
import { Pressable } from "react-native";
import { Text } from "../ui/Text.tsx";

export const ReturnToHomeHeader = () => {
  return (
    <Pressable
      className="flex flex-row items-center gap-1"
      onPress={() => router.push("/")}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <ArrowLeftIcon />
      <Text className="text-primary">Back</Text>
    </Pressable>
  );
};
