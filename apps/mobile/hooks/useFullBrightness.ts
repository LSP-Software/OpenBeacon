import { tryCatch } from "@openbeacon/shared";
import * as Brightness from "expo-brightness";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";

export const useFullBrightness = () => {
  useEffect(() => {
    let queue = Promise.resolve();
    let previous: number | null = null;
    let brightened = false;
    const enqueue = (task: () => Promise<void>) => {
      queue = queue.then(task);
    };

    const brighten = async () => {
      if (brightened) return;
      if (Platform.OS === "ios") {
        const current = await tryCatch(Brightness.getBrightnessAsync());
        if (current.error) return;
        previous = current.data;
      }
      brightened = true;
      await tryCatch(Brightness.setBrightnessAsync(1));
    };

    const restore = async () => {
      if (!brightened) return;
      brightened = false;
      if (Platform.OS === "android") {
        await tryCatch(Brightness.restoreSystemBrightnessAsync());
        return;
      }
      if (previous !== null) await tryCatch(Brightness.setBrightnessAsync(previous));
      previous = null;
    };

    enqueue(brighten);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") enqueue(brighten);
      if (state === "background") enqueue(restore);
    });
    return () => {
      subscription.remove();
      enqueue(restore);
    };
  }, []);
};
