import * as React from "react";
import { View } from "react-native";
import { cn } from "../../lib/cn.ts";
import { Label } from "./Label.tsx";
import { Text } from "./Text.tsx";

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
          "flex w-full shrink min-w-0 gap-2",
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

function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  const field = useFieldContext();

  return (
    <Label
      className={cn(
        {
          "text-destructive-text": field.invalid,
        },
        className,
      )}
      disabled={props.disabled ?? field.disabled}
      {...props}
    />
  );
}

function FieldDescription({ className, ...props }: React.ComponentProps<typeof Text>) {
  return <Text className={cn("text-tertiary text-sm", className)} {...props} />;
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
        {uniqueErrors.map((error) => (
          <Text key={error?.message} className="text-destructive-text text-sm font-normal">
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
        <Text className="text-destructive-text text-sm font-normal">{content}</Text>
      ) : (
        content
      )}
    </View>
  );
}

export { Field, FieldLabel, FieldDescription, FieldError };
