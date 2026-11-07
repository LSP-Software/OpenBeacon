import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { Text } from "../../components/ui/Text.tsx";

const RecoveryRestoreScreen = () => (
  <View className="flex-1 bg-background">
    <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
      <View className="flex-row items-center justify-between">
        <BackButton />
        <Text className="text-foreground text-2xl font-bold">Restore</Text>
        <View className="w-10" />
      </View>
    </SafeAreaView>

    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-4 px-6 py-6 pb-32"
      showsVerticalScrollIndicator={false}
    >
      <Text className="text-foreground text-3xl font-bold">You already have a recovery phrase</Text>
      <Text className="text-muted-foreground text-base leading-6">
        A recovery phrase was set up for this account on another phone, so a new one can’t be
        created here.
      </Text>
      <Text className="text-muted-foreground text-base leading-6">
        Restoring your phrase on this phone is coming in an update. Until then, this phone keeps
        sharing your live location, and your other phone keeps your history protected.
      </Text>
    </ScrollView>
  </View>
);

export default RecoveryRestoreScreen;
