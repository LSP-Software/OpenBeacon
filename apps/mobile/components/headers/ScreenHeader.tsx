import { type Href, Stack, useNavigation } from "expo-router";
import { View } from "react-native";
import { Text } from "../ui/Text.tsx";
import { BackButton } from "./BackButton.tsx";

export const ScreenHeader = ({
  title,
  subtitle,
  hideBack = false,
  fallback,
}: {
  title: string;
  subtitle?: string | undefined;
  hideBack?: boolean;
  fallback?: Href;
}) => {
  const navigation = useNavigation();
  const backMissing = !hideBack && !navigation.canGoBack();

  return (
    <Stack.Screen
      options={{
        headerShown: true,
        title,
        headerBackVisible: !hideBack,
        gestureEnabled: !hideBack,
        ...(backMissing
          ? { headerLeft: () => (fallback ? <BackButton fallback={fallback} /> : <BackButton />) }
          : hideBack
            ? { headerLeft: () => null }
            : {}),
        ...(subtitle
          ? {
              headerTitle: () => (
                <View>
                  <Text
                    accessibilityRole="header"
                    className="text-lg font-semibold"
                    numberOfLines={1}
                  >
                    {title}
                  </Text>
                  <Text className="text-xs text-secondary" numberOfLines={1}>
                    {subtitle}
                  </Text>
                </View>
              ),
            }
          : {}),
      }}
    />
  );
};
