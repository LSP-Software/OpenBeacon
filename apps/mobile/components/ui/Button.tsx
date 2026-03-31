import { cva, type VariantProps } from "class-variance-authority";
import { ActivityIndicator, Pressable } from "react-native";
import { cn } from "../../lib/cn.ts";
import { TextClassContext } from "./Text.tsx";

const buttonVariants = cva(
  "group shrink-0 flex-row items-center justify-center gap-2 rounded-lg shadow-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary active:bg-primary/90 shadow-sm shadow-black/5",
        destructive:
          "bg-destructive active:bg-destructive/90 dark:bg-destructive/60 shadow-sm shadow-black/5",
        outline: "bg-transparent border-[1.5px] border-primary",
        secondary: "bg-secondary active:bg-secondary/80 shadow-sm shadow-black/5",
        ghost: "active:bg-accent dark:active:bg-accent/50",
        link: "",
      },
      size: {
        default: "h-14 px-6 py-3 sm:h-11",
        sm: "h-10 gap-1.5 rounded-lg px-4 sm:h-9",
        lg: "h-14 rounded-lg px-7 sm:h-12",
        icon: "h-12 w-12 sm:h-10 sm:w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const buttonTextVariants = cva("text-white text-base font-semibold rounded-lg", {
  variants: {
    variant: {
      default: "text-white",
      destructive: "text-destructive-foreground",
      outline: "text-primary",
      secondary: "text-secondary-foreground",
      ghost: "group-active:text-accent-foreground",
      link: "text-primary group-active:underline",
    },
    size: {
      default: "",
      sm: "",
      lg: "",
      icon: "",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

type ButtonProps = React.ComponentProps<typeof Pressable> &
  React.RefAttributes<typeof Pressable> &
  VariantProps<typeof buttonVariants> &
  ExtendedButtonProps;

type ExtendedButtonProps = {
  loading?: boolean;
};

function Button({ className, variant, size, loading, disabled, ...props }: ButtonProps) {
  return (
    <TextClassContext.Provider value={buttonTextVariants({ variant, size })}>
      <Pressable
        className={cn(
          (disabled || loading) && "opacity-80",
          buttonVariants({ variant, size }),
          className,
        )}
        role="button"
        disabled={loading || disabled}
        {...props}
      >
        {loading ? <ActivityIndicator size="small" color="white" /> : props.children}
      </Pressable>
    </TextClassContext.Provider>
  );
}

export { Button, buttonTextVariants, buttonVariants };
export type { ButtonProps };
