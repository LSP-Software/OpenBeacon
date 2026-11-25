import { CarIcon } from "lucide-react-native";
import { ScrollView, View } from "react-native";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { ListRow, ListSection } from "../../components/ui/List.tsx";
import { Switch } from "../../components/ui/Switch.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { authClient } from "../../lib/auth-client.ts";
import { setDriveDetection, useDriveDetection } from "../../lib/driveDetection.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

const DriveDetectionScreen = () => {
  const on = useDriveDetection();
  const { data: session } = authClient.useSession();
  const change = (next: boolean) => void setDriveDetection(next, session?.user.id);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Drive detection" />

      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-4 pb-10 pt-2"
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-secondary px-4 text-[15px] leading-5">
          {`When this ${thisDeviceNoun()} is in a moving vehicle, OpenBeacon records the drive: when and where it started and ended, how far it went and how fast. Your drives are end-to-end encrypted and shared with your groups, like your location history.`}
        </Text>
        <ListSection
          footer={`While a drive is being recorded, the sharing notice says “Recording a drive”. Bus, train and taxi rides can be recorded too. When this is off, this ${thisDeviceNoun()} records no drives and your groups see that Drive detection is off.`}
        >
          <ListRow
            title="Drive detection"
            icon={CarIcon}
            iconColor="teal"
            subtitle={on ? `On for this ${thisDeviceNoun()}.` : `Off for this ${thisDeviceNoun()}.`}
            accessibilityRole="switch"
            accessibilityState={{ checked: on }}
            onPress={() => change(!on)}
            trailing={
              <Switch accessibilityLabel="Drive detection" value={on} onValueChange={change} />
            }
          />
        </ListSection>
      </ScrollView>
    </View>
  );
};

export default DriveDetectionScreen;
