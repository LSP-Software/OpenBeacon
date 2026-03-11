import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/Button";
import { useState } from "react";

export default function Test() {
  const [scheme, setScheme] = useState<"light" | "dark">("light");

  return (
    <SafeAreaView className="flex-1">
      <View
        key={scheme}
        className={`${scheme === "dark" ? "dark" : ""} flex-1 items-center justify-center px-6 bg-background`}
      >
        <Text className="text-3xl text-white">nativewind is working</Text>
        <Button
          title={`change scheme ${scheme}`}
          onPress={() => setScheme(scheme === "light" ? "dark" : "light")}
        />
      </View>
    </SafeAreaView>
  );
}
