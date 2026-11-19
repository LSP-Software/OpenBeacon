import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

let lastKnownReduced = false;

export const useReducedMotion = () => {
  const [reduced, setReduced] = useState(lastKnownReduced);
  useEffect(() => {
    let active = true;
    const update = (enabled: boolean) => {
      lastKnownReduced = enabled;
      if (active) setReduced(enabled);
    };
    void AccessibilityInfo.isReduceMotionEnabled().then(update);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", update);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduced;
};
