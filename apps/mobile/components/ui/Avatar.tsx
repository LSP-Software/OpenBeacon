import * as AvatarPrimitive from "@rn-primitives/avatar";
import { cn } from "../../lib/cn.ts";
import { TextClassContext } from "./Text.tsx";

function Avatar({
  className,
  ...props
}: AvatarPrimitive.RootProps & React.RefAttributes<AvatarPrimitive.RootRef>) {
  return (
    <AvatarPrimitive.Root
      className={cn("relative flex size-8 shrink-0 overflow-hidden rounded-full", className)}
      {...props}
    />
  );
}

function AvatarImage({
  className,
  ...props
}: AvatarPrimitive.ImageProps & React.RefAttributes<AvatarPrimitive.ImageRef>) {
  return <AvatarPrimitive.Image className={cn("aspect-square size-full", className)} {...props} />;
}

function AvatarFallback({
  className,
  ...props
}: AvatarPrimitive.FallbackProps & React.RefAttributes<AvatarPrimitive.FallbackRef>) {
  return (
    <TextClassContext.Provider value="text-white items-center">
      <AvatarPrimitive.Fallback
        className={cn(
          "bg-brand flex size-full flex-row items-center justify-center rounded-full",
          className,
        )}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

export { Avatar, AvatarFallback, AvatarImage };
