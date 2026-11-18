import { cva, type VariantProps } from "class-variance-authority";
import { ActivityIndicator, Pressable } from "react-native";
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
        default: "h-[52px] px-6",
        sm: "h-10 gap-1.5 px-4",
        icon: "size-11",
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
      icon: "",
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

function Button({ className, variant, size, loading, disabled, ...props }: ButtonProps) {
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
        {...props}
      >
        {loading ? (
          <ActivityIndicator size="small" className={spinnerColors[variant ?? "default"]} />
        ) : (
          props.children
        )}
      </Pressable>
    </TextClassContext.Provider>
  );
}

export { Button, buttonTextVariants, buttonVariants };
export type { ButtonProps };
