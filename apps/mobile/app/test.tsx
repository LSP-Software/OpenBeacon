import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/Button";
import { Text } from "../components/Text";
import { useState } from "react";

export default function Test() {
  const [scheme, setScheme] = useState<"light" | "dark">("light");

  return (
    <SafeAreaView className="flex-1">
      <View
        key={scheme}
        className={`${scheme === "dark" ? "dark" : ""} flex-1 items-center justify-center px-6 bg-background`}
      >
        <Text className="text-3xl">nativewind is working</Text>
        <Text className="text-xl text-muted">muted text</Text>
        <Button
          variant="primary"
          title={`change scheme ${scheme}`}
          onPress={() => setScheme(scheme === "light" ? "dark" : "light")}
        />
      </View>
    </SafeAreaView>
  );
}
