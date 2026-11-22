import { Platform } from "react-native";

const ios = Platform.OS === "ios";

export const groupedListClassName = ios ? "overflow-hidden rounded-[26px] bg-card" : "gap-[2px]";

export const groupedRowClassName = (index: number) =>
  ios && index > 0 ? "bg-card border-t-hairline border-border" : "bg-card";

export const groupedRowStyle = (index: number, count: number) =>
  ios
    ? undefined
    : {
        borderTopLeftRadius: index === 0 ? 20 : 4,
        borderTopRightRadius: index === 0 ? 20 : 4,
        borderBottomLeftRadius: index === count - 1 ? 20 : 4,
        borderBottomRightRadius: index === count - 1 ? 20 : 4,
      };
