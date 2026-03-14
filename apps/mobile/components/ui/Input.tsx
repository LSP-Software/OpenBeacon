import { useState } from "react";
import { type Control, Controller, type FieldPath, type FieldValues } from "react-hook-form";
import { Platform, TextInput, type TextInputProps } from "react-native";
import { cn } from "../../lib/cn";
import { Field, FieldError } from "./Field";

type FormInputProps<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>> = Omit<
  TextInputProps,
  "value" | "onChangeText"
> & {
  control: Control<TFieldValues>;
  name: TName;
  label: string;
  fieldClassName?: string;
  hideError?: boolean;
};

function Input<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>({
  control,
  name,
  label,
  fieldClassName,
  hideError = false,
  className,
  onBlur,
  onFocus,
  ...props
}: FormInputProps<TFieldValues, TName>) {
  const [inputFocused, setInputFocused] = useState(false);

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        return (
          <Field data-invalid={fieldState.invalid}>
            <TextInput
              {...field}
              onChangeText={field.onChange}
              onFocus={() => setInputFocused(true)}
              onBlur={() => {
                setInputFocused(false);
                field.onBlur();
              }}
              className={cn(
                `rounded-lg border border-border bg-input ${inputFocused && "border-primary"} py-4 px-4 `,
                props.editable === false &&
                  cn(
                    "opacity-50",
                    Platform.select({
                      web: "disabled:pointer-events-none disabled:cursor-not-allowed",
                    }),
                  ),
                Platform.select({
                  web: cn(
                    "placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground outline-none transition-[color,box-shadow] md:text-sm",
                    "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                    "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
                  ),
                  native: "placeholder:text-secondary",
                }),
                className,
              )}
              {...props}
            />
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        );
      }}
    />
  );
}

export { Input };

// biome-ignore lint/complexity/noUselessLoneBlockStatements: 123
{
  /* <Controller
  name="name"
  control={form.control}
  render={({ field, fieldState }) => (
    <Field data-invalid={fieldState.invalid}>
      <FieldLabel htmlFor="form-rhf-demo-title">Bug Title</FieldLabel>
      <Input
        {...field}
        onChangeText={field.onChange}
        aria-invalid={fieldState.invalid}
        placeholder="Group name"
        autoComplete="off"
      />
      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
    </Field>
  )}
/>; */
}
