import * as DialogPrimitive from "@rn-primitives/dialog";
import { X } from "lucide-react-native";
import * as React from "react";
import { Platform, View, type ViewProps } from "react-native";
import { FadeIn, FadeOut } from "react-native-reanimated";
import { FullWindowOverlay as RNFullWindowOverlay } from "react-native-screens";
import { cn } from "../../lib/cn.ts";
import { AnimatedView } from "./AnimatedView.tsx";
import { Icon } from "./Icon.tsx";

const Dialog = DialogPrimitive.Root;

const DialogPortal = DialogPrimitive.Portal;

const FullWindowOverlay = Platform.OS === "ios" ? RNFullWindowOverlay : React.Fragment;

const DialogOverlay = ({
  className,
  children,
  ...props
}: Omit<DialogPrimitive.OverlayProps, "asChild"> &
  React.RefAttributes<DialogPrimitive.OverlayRef> & {
    children?: React.ReactNode;
  }) => {
  return (
    <FullWindowOverlay>
      <DialogPrimitive.Overlay
        className={cn(
          "absolute bottom-0 left-0 right-0 top-0 flex items-center justify-center bg-black/50 p-4",
          className,
        )}
        {...props}
        asChild
      >
        <AnimatedView entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
          {children}
        </AnimatedView>
      </DialogPrimitive.Overlay>
    </FullWindowOverlay>
  );
};

const DialogContent = ({
  className,
  portalHost,
  showClose = true,
  children,
  ...props
}: DialogPrimitive.ContentProps &
  React.RefAttributes<DialogPrimitive.ContentRef> & {
    portalHost?: string;
    showClose?: boolean;
  }) => {
  const portalProps = portalHost ? { hostName: portalHost } : {};

  return (
    <DialogPortal {...portalProps}>
      <DialogOverlay>
        <DialogPrimitive.Content
          className={cn(
            "bg-background z-50 mx-auto flex w-full max-w-full flex-col gap-4 rounded-[28px] p-6 sm:max-w-lg",
            className,
          )}
          {...props}
        >
          {children}
          {showClose && (
            <DialogPrimitive.Close
              className="absolute right-3 top-3 size-10 items-center justify-center rounded-full bg-container"
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Icon as={X} className="text-foreground size-5 shrink-0" />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogOverlay>
    </DialogPortal>
  );
};

const DialogHeader = ({ className, ...props }: ViewProps) => {
  return (
    <View className={cn("flex flex-col gap-2 text-center sm:text-left", className)} {...props} />
  );
};

const DialogFooter = ({ className, ...props }: ViewProps) => {
  return (
    <View
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
};

const DialogTitle = ({
  className,
  ...props
}: DialogPrimitive.TitleProps & React.RefAttributes<DialogPrimitive.TitleRef>) => {
  return (
    <DialogPrimitive.Title className={cn("text-foreground pr-10 text-2xl", className)} {...props} />
  );
};

const DialogDescription = ({
  className,
  ...props
}: DialogPrimitive.DescriptionProps & React.RefAttributes<DialogPrimitive.DescriptionRef>) => {
  return (
    <DialogPrimitive.Description className={cn("text-secondary text-base", className)} {...props} />
  );
};

export { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle };
