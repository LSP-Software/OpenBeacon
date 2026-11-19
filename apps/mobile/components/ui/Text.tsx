import * as Slot from "@rn-primitives/slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { Text as RNText } from "react-native";
import { cn } from "../../lib/cn.ts";

const textVariants = cva("text-foreground text-base", {
  variants: {
    variant: {
      default: "",
      h3: "text-2xl font-semibold tracking-tight",
      label: "text-secondary text-sm font-semibold",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

type TextVariantProps = VariantProps<typeof textVariants>;

const TextClassContext = React.createContext<string | undefined>(undefined);

function Text({
  className,
  asChild = false,
  variant = "default",
  ...props
}: React.ComponentProps<typeof RNText> &
  TextVariantProps &
  React.RefAttributes<RNText> & {
    asChild?: boolean;
  }) {
  const textClass = React.useContext(TextClassContext);
  const Component = asChild ? Slot.Text : RNText;
  return (
    <Component
      className={cn(textVariants({ variant }), textClass, className)}
      role={variant === "h3" ? "heading" : undefined}
      aria-level={variant === "h3" ? "3" : undefined}
      {...props}
    />
  );
}

export { Text, TextClassContext };
