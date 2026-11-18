import { cva, type VariantProps } from "class-variance-authority";
import { View, type ViewProps } from "react-native";
import { cn } from "../../lib/cn.ts";
import { Text, TextClassContext } from "./Text.tsx";

const cardVariants = cva("flex flex-col gap-4 rounded-2xl border py-5", {
  variants: {
    variant: {
      default: "bg-card border-border",
      warning: "bg-warning border-warning-border",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

function Card({
  className,
  variant,
  ...props
}: ViewProps & React.RefAttributes<View> & VariantProps<typeof cardVariants>) {
  return (
    <TextClassContext.Provider value="text-card-foreground">
      <View className={cn(cardVariants({ variant }), className)} {...props} />
    </TextClassContext.Provider>
  );
}

function CardHeader({ className, ...props }: ViewProps & React.RefAttributes<View>) {
  return <View className={cn("flex flex-col gap-1.5 px-5", className)} {...props} />;
}

function CardTitle({
  className,
  ...props
}: React.ComponentProps<typeof Text> & React.RefAttributes<Text>) {
  return (
    <Text
      role="heading"
      aria-level={3}
      className={cn("font-semibold leading-none", className)}
      {...props}
    />
  );
}

function CardDescription({
  className,
  ...props
}: React.ComponentProps<typeof Text> & React.RefAttributes<Text>) {
  return <Text className={cn("text-secondary text-sm", className)} {...props} />;
}

function CardContent({ className, ...props }: ViewProps & React.RefAttributes<View>) {
  return <View className={cn("px-5", className)} {...props} />;
}

function CardFooter({ className, ...props }: ViewProps & React.RefAttributes<View>) {
  return <View className={cn("flex flex-row items-center px-5", className)} {...props} />;
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, cardVariants };
