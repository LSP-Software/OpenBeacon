import { View } from "react-native";
import { Button } from "../Button.tsx";
import { Text } from "../Text.tsx";

export const UnsupportedMap = () => {
  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <Text className="text-center text-base text-muted">
        Maps are only available in the native app.
      </Text>
    </View>
  );
};

export const LoadingMap = () => {
  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <Text className="text-center text-base text-muted">Loading map…</Text>
    </View>
  );
};

export const MapLoadError = ({
  onRetry,
  title = "The map could not be loaded.",
}: {
  onRetry: () => void;
  title?: string;
}) => {
  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <View className="w-full max-w-80 gap-5">
        <Text className="text-center text-base text-muted">{title}</Text>
        <Button title="Retry" onPress={onRetry} />
      </View>
    </View>
  );
};
