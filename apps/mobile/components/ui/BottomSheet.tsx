import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export const BottomSheet = ({
  visible,
  onClose,
  closeLabel,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  closeLabel: string;
  children: React.ReactNode;
}) => {
  const insets = useSafeAreaInsets();

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/50">
        <Pressable
          className="absolute inset-0"
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={onClose}
        />
        <View
          accessibilityViewIsModal
          className="max-h-[90%] gap-4 rounded-t-3xl bg-card px-5 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 20) }}
        >
          <View className="h-1 w-9 self-center rounded-full bg-border-strong" />
          {children}
        </View>
      </View>
    </Modal>
  );
};
