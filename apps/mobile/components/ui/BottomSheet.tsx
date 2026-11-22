import {
  ModalBottomSheet,
  type ModalBottomSheetRef,
  RNHostView as ComposeRNHostView,
} from "@expo/ui/jetpack-compose";
import { RNHostView, BottomSheet as SwiftBottomSheet } from "@expo/ui/swift-ui";
import { tryCatch } from "@openbeacon/shared";
import { useEffect, useRef, useState } from "react";
import { Platform, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "../../lib/theme.ts";
import { AndroidHost, IosHost } from "./NativeHost.tsx";

export const BottomSheet = ({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) => {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { palette } = useColors();
  const sheet = useRef<ModalBottomSheetRef>(null);
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    if (!sheet.current) {
      setMounted(false);
      return;
    }
    void tryCatch(sheet.current.hide()).then(() => setMounted(false));
  }, [visible]);

  const content = (
    <View
      accessibilityViewIsModal
      className="gap-4 bg-background px-5"
      style={{
        width,
        paddingTop: Platform.OS === "ios" ? 24 : 0,
        paddingBottom: Math.max(insets.bottom, 20),
      }}
    >
      {children}
    </View>
  );

  if (Platform.OS === "ios") {
    return (
      <IosHost style={{ position: "absolute", width: 0, height: 0 }}>
        <SwiftBottomSheet
          isPresented={visible}
          onIsPresentedChange={(presented) => {
            if (!presented) onClose();
          }}
          fitToContents
        >
          <RNHostView matchContents>{content}</RNHostView>
        </SwiftBottomSheet>
      </IosHost>
    );
  }

  if (!mounted) return null;

  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height }}>
      <AndroidHost style={{ width, height }}>
        <ModalBottomSheet
          ref={sheet}
          onDismissRequest={onClose}
          containerColor={palette.background}
          showDragHandle
          skipPartiallyExpanded
        >
          <ComposeRNHostView matchContents>{content}</ComposeRNHostView>
        </ModalBottomSheet>
      </AndroidHost>
    </View>
  );
};
