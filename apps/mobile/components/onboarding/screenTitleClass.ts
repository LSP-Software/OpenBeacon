import { Platform } from "react-native";

export const screenTitleClass =
  Platform.OS === "ios"
    ? "text-foreground text-[34px] font-bold leading-[41px]"
    : "text-foreground text-[32px] leading-10";
