import { View } from "react-native";
import { Button } from "../ui/Button.tsx";
import { Text } from "../ui/Text.tsx";

export const ProblemNote = ({
  loading,
  message,
  onRetry,
}: {
  loading: boolean;
  message: string;
  onRetry: () => void;
}) => (
  <View className="items-center gap-3 py-3">
    <Text className="text-center text-foreground">{message}</Text>
    <Button size="sm" variant="secondary" loading={loading} onPress={onRetry}>
      <Text>Try again</Text>
    </Button>
  </View>
);
