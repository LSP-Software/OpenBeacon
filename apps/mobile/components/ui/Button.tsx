import { cva, type VariantProps } from "class-variance-authority";
import { isValidElement, type ReactNode } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { cn } from "../../lib/cn.ts";
import { TextClassContext } from "./Text.tsx";

const buttonVariants = cva(
  "group shrink-0 flex-row items-center justify-center gap-2 rounded-lg [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-action active:bg-action/90",
        destructive: "bg-destructive active:bg-destructive/90",
        danger: "bg-destructive-soft active:bg-destructive-soft/80",
        secondary: "bg-secondary active:bg-secondary/70",
        ghost: "active:bg-secondary",
        link: "",
      },
      size: {
        default: "min-h-[52px] px-6 py-2",
        sm: "min-h-10 gap-1.5 px-4 py-1",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const buttonTextVariants = cva("text-base font-semibold", {
  variants: {
    variant: {
      default: "text-white",
      destructive: "text-destructive-foreground",
      danger: "text-destructive-text",
      secondary: "text-secondary-foreground",
      ghost: "text-primary-text",
      link: "text-primary-text group-active:underline",
    },
    size: {
      default: "",
      sm: "text-sm",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

const spinnerColors = {
  default: "text-white",
  destructive: "text-destructive-foreground",
  danger: "text-destructive-text",
  secondary: "text-secondary-foreground",
  ghost: "text-primary-text",
  link: "text-primary-text",
} as const;

type ButtonProps = React.ComponentProps<typeof Pressable> &
  React.RefAttributes<typeof Pressable> &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean;
  };

function Button({
  className,
  variant,
  size,
  loading,
  disabled,
  accessibilityLabel,
  ...props
}: ButtonProps) {
  return (
    <TextClassContext.Provider value={buttonTextVariants({ variant, size })}>
      <Pressable
        className={cn(
          (disabled || loading) && "opacity-50",
          buttonVariants({ variant, size }),
          className,
        )}
        role="button"
        disabled={loading || disabled}
        // React Native's Android BaseViewManager writes "busy" into the content description but
        // never clears it afterwards when the view has no accessibility label, so the button is
        // announced as "busy" until it remounts. A label built from the button's text avoids that.
        accessibilityLabel={
          accessibilityLabel ??
          (typeof props.children === "function"
            ? undefined
            : textOf(props.children).replace(/\s+/g, " ").trim() || undefined)
        }
        accessibilityState={{ disabled: !!(loading || disabled), busy: !!loading }}
        {...props}
      >
        {loading ? (
          <>
            <View className="flex-row items-center gap-2 opacity-0">
              {typeof props.children === "function" ? null : props.children}
            </View>
            <View className="absolute inset-0 items-center justify-center">
              <ActivityIndicator size="small" className={spinnerColors[variant ?? "default"]} />
            </View>
          </>
        ) : (
          props.children
        )}
      </Pressable>
    </TextClassContext.Provider>
  );
}

const textOf = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).filter(Boolean).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
};

export { Button };
