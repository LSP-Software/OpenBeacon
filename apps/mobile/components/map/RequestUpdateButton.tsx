import { RefreshCwIcon } from "lucide-react-native";
import { View } from "react-native";
import { useRequestUpdate } from "../../hooks/useRequestUpdate.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";

type RequestUpdate = ReturnType<typeof useRequestUpdate>;

export const RequestUpdateButton = ({ update, size }: { update: RequestUpdate; size?: "tile" }) => (
  <Button
    variant="secondary"
    size={size}
    disabled={update.asked}
    loading={update.asking}
    onPress={() => void update.request()}
  >
    <Icon as={RefreshCwIcon} size={18} className="text-foreground" />
    <Text maxFontSizeMultiplier={size === "tile" ? 1.3 : undefined}>
      {update.asked ? (size === "tile" ? "Requested" : "Update requested") : "Update now"}
    </Text>
  </Button>
);

export const RequestUpdateMessage = ({ update }: { update: RequestUpdate }) =>
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
