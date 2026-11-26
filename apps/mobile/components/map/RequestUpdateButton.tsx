import { RefreshCwIcon } from "lucide-react-native";
import { View } from "react-native";
import { useRequestUpdate } from "../../hooks/useRequestUpdate.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";

export const RequestUpdateButton = ({
  update,
  size,
}: {
  update: ReturnType<typeof useRequestUpdate>;
  size?: "tile";
}) => (
  <Button
    variant="secondary"
    size={size}
    disabled={update.asked}
    loading={update.asking}
    accessibilityLabel={update.asked ? "Update requested" : "Update now"}
    onPress={() => void update.request()}
  >
    <Icon as={RefreshCwIcon} size={18} className="text-foreground" />
    <Text>
      {update.asked ? (size === "tile" ? "Requested" : "Update requested") : "Update now"}
    </Text>
  </Button>
);

export const RequestUpdateMessage = ({
  update,
}: {
  update: ReturnType<typeof useRequestUpdate>;
}) =>
  update.message ? (
    <Text
      accessibilityLiveRegion="polite"
      className={update.messageIsError ? "text-destructive-text text-sm" : "text-secondary text-sm"}
    >
      {update.message}
    </Text>
  ) : null;

export const RequestUpdateSection = (props: Parameters<typeof useRequestUpdate>[0]) => {
  const update = useRequestUpdate(props);
  return (
    <View className="mt-4 gap-2">
      <RequestUpdateButton update={update} />
      <RequestUpdateMessage update={update} />
    </View>
  );
};
