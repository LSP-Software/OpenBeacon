import { useEffect, useEffectEvent } from "react";
import { AppState } from "react-native";

export const useAppForeground = (onForeground: () => void) => {
  const handleForeground = useEffectEvent(onForeground);

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener("change", (nextState) => {
      const cameBack =
        (previousState === "background" || previousState === "inactive") && nextState === "active";
      previousState = nextState;
      if (cameBack) handleForeground();
    });
    return () => subscription.remove();
  }, []);
};
