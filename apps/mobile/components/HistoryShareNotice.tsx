import { router } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useHistoryShare } from "../hooks/useHistoryShare.ts";
import { getBaseUrl } from "../lib/currentServer.ts";
import { storage } from "../lib/storage.ts";
import { Button } from "./ui/Button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/Dialog.tsx";
import { Text } from "./ui/Text.tsx";

export const HistoryShareNotice = ({ userId }: { userId: string }) => {
  const key = `historyShareNotice.${JSON.stringify([getBaseUrl(), userId])}`;
  const [seen, setSeen] = useState(() => storage.getString(key) !== undefined);
  const { setting } = useHistoryShare(!seen);
  const dismiss = () => {
    storage.set(key, "seen");
    setSeen(true);
  };
  const alreadyChose = !seen && setting !== null && setting.changedAt !== null;
  useEffect(() => {
    if (!alreadyChose) return;
    storage.set(key, "seen");
    setSeen(true);
  }, [alreadyChose, key]);
  const open = !seen && setting !== null && setting.changedAt === null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your groups can see up to 30 days of your location history</DialogTitle>
          <DialogDescription>
            Members can play back where you’ve been in Timeline, from when they joined. You can
            share less, or only your location now, for all your groups or one group at a time.
          </DialogDescription>
        </DialogHeader>
        <View className="gap-3">
          <Button
            onPress={() => {
              dismiss();
              router.push("/account/location-history");
            }}
          >
            <Text>Choose how much to share</Text>
          </Button>
          <Button variant="secondary" onPress={dismiss}>
            <Text>OK</Text>
          </Button>
        </View>
      </DialogContent>
    </Dialog>
  );
};
