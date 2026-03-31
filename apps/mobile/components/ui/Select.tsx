import * as SelectPrimitive from "@rn-primitives/select";
import { Check, ChevronDown } from "lucide-react-native";
import * as React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { FadeIn, FadeOut } from "react-native-reanimated";
import { FullWindowOverlay as RNFullWindowOverlay } from "react-native-screens";
import { cn } from "../../lib/cn.ts";
import { AnimatedView } from "./AnimatedView.tsx";
import { Icon } from "./Icon.tsx";
import { TextClassContext } from "./Text.tsx";

type Option = SelectPrimitive.Option;

const Select = SelectPrimitive.Root;

const SelectGroup = SelectPrimitive.Group;

function SelectValue({
  ref,
  className,
  ...props
}: SelectPrimitive.ValueProps &
  React.RefAttributes<SelectPrimitive.ValueRef> & {
    className?: string;
  }) {
  const { value } = SelectPrimitive.useRootContext();
  return (
    <SelectPrimitive.Value
      ref={ref}
      className={cn(
        "text-foreground line-clamp-1 flex flex-row items-center gap-2 text-sm",
        !value && "text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function SelectTrigger({
  ref,
  className,
  children,
  size = "default",
  ...props
}: SelectPrimitive.TriggerProps &
  React.RefAttributes<SelectPrimitive.TriggerRef> & {
    children?: React.ReactNode;
    size?: "default" | "sm";
  }) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        "border-input dark:bg-input/30 dark:active:bg-input/50 bg-background flex h-10 flex-row items-center justify-between gap-2 rounded-md border px-3 py-2 shadow-sm shadow-black/5 sm:h-9",
        "text-sm",
        props.disabled && "opacity-50",
        size === "sm" && "h-8 py-2 sm:py-1.5",
        className,
      )}
      {...props}
    >
      {children}
      <Icon as={ChevronDown} aria-hidden={true} className="text-muted-foreground size-4" />
    </SelectPrimitive.Trigger>
  );
}

const FullWindowOverlay = Platform.OS === "ios" ? RNFullWindowOverlay : React.Fragment;

function SelectContent({
  className,
  children,
  position = "popper",
  portalHost,
  ...props
}: SelectPrimitive.ContentProps &
  React.RefAttributes<SelectPrimitive.ContentRef> & {
    className?: string;
    portalHost?: string;
  }) {
  const portalProps = portalHost ? { hostName: portalHost } : {};
  return (
    <SelectPrimitive.Portal {...portalProps}>
      <FullWindowOverlay>
        <SelectPrimitive.Overlay style={StyleSheet.absoluteFill}>
          <TextClassContext.Provider value="text-popover-foreground">
            <AnimatedView className="z-50" entering={FadeIn} exiting={FadeOut}>
              <SelectPrimitive.Content
                className={cn(
                  "bg-popover border-border relative z-50 min-w-[8rem] rounded-md border shadow-md shadow-black/5",
                  "p-1",
                  className,
                )}
                position={position}
                {...props}
              >
                <SelectPrimitive.Viewport className={cn("p-1", position === "popper" && "w-full")}>
                  {children}
                </SelectPrimitive.Viewport>
              </SelectPrimitive.Content>
            </AnimatedView>
          </TextClassContext.Provider>
        </SelectPrimitive.Overlay>
      </FullWindowOverlay>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.LabelProps & React.RefAttributes<SelectPrimitive.LabelRef>) {
  return (
    <SelectPrimitive.Label
      className={cn("text-muted-foreground px-2 py-2 text-xs sm:py-1.5", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.ItemProps & React.RefAttributes<SelectPrimitive.ItemRef>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "active:bg-accent group relative flex w-full flex-row items-center gap-2 rounded-sm py-2 pl-2 pr-8 sm:py-1.5",
        props.disabled && "opacity-50",
        className,
      )}
      {...props}
    >
      <View className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Icon as={Check} className="text-muted-foreground size-4 shrink-0" />
        </SelectPrimitive.ItemIndicator>
      </View>
      <SelectPrimitive.ItemText className="text-foreground group-active:text-accent-foreground select-none text-sm" />
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.SeparatorProps & React.RefAttributes<SelectPrimitive.SeparatorRef>) {
  return (
    <SelectPrimitive.Separator className={cn("bg-border -mx-1 my-1 h-px", className)} {...props} />
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  type Option,
};
