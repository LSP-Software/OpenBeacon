import { Link } from "expo-router";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/ui/Button.tsx";
import { Text } from "../components/ui/Text.tsx";

const DeviceRemovedScreen = () => (
  <SafeAreaView className="flex-1 justify-between bg-background px-8 py-6">
    <View className="flex-1 justify-center gap-4">
      <Text className="text-foreground text-3xl font-bold">
        This phone was removed from your account
      </Text>
      <Text className="text-muted-foreground text-base leading-6">
        Its keys, saved locations and queued uploads have been deleted from this phone. To use it
        again, sign in and set it up. It’ll be added as a new device.
      </Text>
    </View>
    <Link href="/" replace asChild>
      <Button className="mb-8">
        <Text>Continue</Text>
      </Button>
    </Link>
  </SafeAreaView>
);

export default DeviceRemovedScreen;
