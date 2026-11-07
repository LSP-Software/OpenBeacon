import { useEffect, useSyncExternalStore } from "react";
import { Keyboard, ScrollView, useWindowDimensions } from "react-native";
import { dismissAlert, getSnapshot, subscribe } from "../../lib/alert.ts";
import { Button } from "./Button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./Dialog.tsx";
import { Text } from "./Text.tsx";

export const AlertHost = () => {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)[0];
  const { height } = useWindowDimensions();

  useEffect(() => {
    if (current) Keyboard.dismiss();
  }, [current]);

  return (
    <Dialog
      open={!!current}
      onOpenChange={(open) => {
        if (!open && current?.options?.cancelable) {
          dismissAlert();
          current.options.onDismiss?.();
        }
      }}
    >
      {current && (
        <DialogContent showClose={false} style={{ maxHeight: height - 32 }}>
          <ScrollView
            className="shrink"
            contentContainerClassName="gap-4"
            keyboardShouldPersistTaps="always"
          >
            <DialogHeader>
              <DialogTitle>{current.title}</DialogTitle>
              {current.message && <DialogDescription>{current.message}</DialogDescription>}
            </DialogHeader>
            <DialogFooter>
              {current.buttons.map((button) => (
                <Button
                  key={button.text}
                  variant={
                    button.style === "destructive"
                      ? "destructive"
                      : button.style === "cancel"
                        ? "secondary"
                        : "default"
                  }
                  onPress={() => {
                    dismissAlert();
                    button.onPress?.();
                  }}
                >
                  <Text>{button.text ?? "OK"}</Text>
                </Button>
              ))}
            </DialogFooter>
          </ScrollView>
        </DialogContent>
      )}
    </Dialog>
  );
};
