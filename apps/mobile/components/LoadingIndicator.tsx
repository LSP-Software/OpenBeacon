import { ActivityIndicator, View } from "react-native";

export const LoadingIndicator = () => {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <ActivityIndicator size="large" color={"red"} />
    </View>
  );
};
