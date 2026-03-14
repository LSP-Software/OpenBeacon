import * as React from "react";
import { View } from "react-native";
import { cn } from "../../lib/cn";
import { Label } from "./Label";
import { Text } from "./Text";

type FieldOrientation = "vertical" | "horizontal";

interface FieldContextValue {
  orientation: FieldOrientation;
  disabled?: boolean;
  invalid?: boolean;
}

const FieldContext = React.createContext<FieldContextValue | null>(null);

function useFieldContext() {
  return React.useContext(FieldContext) ?? { orientation: "vertical" as const };
}

function FieldSet({ className, ...props }: React.ComponentProps<typeof View>) {
  return <View className={cn("flex flex-col gap-3", className)} {...props} />;
}

function FieldLegend({
  className,
  ...props
}: React.ComponentProps<typeof Text> & { variant?: "legend" | "label" }) {
  return <Text className={cn("font-sans-medium", className)} {...props} />;
}

function FieldGroup({ className, ...props }: React.ComponentProps<typeof View>) {
  return <View className={cn("flex w-full flex-col gap-3", className)} {...props} />;
}

function Field({
  className,
  orientation = "vertical",
  disabled,
  invalid,
  ...props
}: React.ComponentProps<typeof View> & {
  orientation?: FieldOrientation;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <FieldContext.Provider
      value={{ orientation, disabled: disabled ?? false, invalid: invalid ?? false }}
    >
      <View
        className={cn(
          "flex w-full gap-2",
          {
            "flex-row items-center": orientation === "horizontal",
          },
          className,
        )}
        {...props}
      />
    </FieldContext.Provider>
  );
}

function FieldContent({ className, ...props }: React.ComponentProps<typeof View>) {
  return <View className={cn("flex flex-1 flex-col gap-1", className)} {...props} />;
}

function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  const field = useFieldContext();

  return (
    <Label
      className={cn(
        {
          "text-destructive": field.invalid,
        },
        className,
      )}
      disabled={props.disabled ?? field.disabled}
      {...props}
    />
  );
}

function FieldTitle({ className, ...props }: React.ComponentProps<typeof Text>) {
  const { disabled } = useFieldContext();

  return (
    <Text
      className={cn(
        "font-sans-medium flex flex-row items-center gap-2 text-sm",
        disabled && "opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function FieldDescription({ className, ...props }: React.ComponentProps<typeof Text>) {
  return <Text className={cn("text-muted-foreground text-sm", className)} {...props} />;
}

function FieldSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<typeof View> & {
  children?: React.ReactNode;
}) {
  return (
    <View className={cn("relative h-5 justify-center", className)} {...props}>
      <View className="border-border absolute inset-0 top-1/2 border-t" />
      {!!children && (
        <Text className="bg-background text-muted-foreground mx-auto px-2 text-sm">{children}</Text>
      )}
    </View>
  );
}

function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<typeof View> & {
  errors?: ({ message?: string } | undefined)[];
}) {
  const content = React.useMemo(() => {
    if (children) {
      return children;
    }

    if (!errors?.length) {
      return null;
    }

    const uniqueErrors = [
      ...new Map(errors.map((error) => [error?.message, error])).values(),
    ].filter((error) => !!error?.message);

    if (uniqueErrors.length === 0) {
      return null;
    }

    if (uniqueErrors.length === 1) {
      return uniqueErrors[0]?.message;
    }

    return (
      <View className="gap-1">
        {uniqueErrors.map((error, index) => (
          <Text key={`${error?.message}-${index}`} className="text-destructive text-sm font-normal">
            {`\u2022 ${error?.message}`}
          </Text>
        ))}
      </View>
    );
  }, [children, errors]);

  if (!content) {
    return null;
  }

  return (
    <View className={cn("gap-1", className)} {...props}>
      {typeof content === "string" ? (
        <Text className="text-destructive text-sm font-normal">{content}</Text>
      ) : (
        content
      )}
    </View>
  );
}

export {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
};
