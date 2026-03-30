import { type Control, Controller, type FieldPath, type FieldValues } from "react-hook-form";
import { type TextInputProps, View } from "react-native";
import { cn } from "../../lib/cn.ts";
import { Field, FieldDescription, FieldError, FieldLabel } from "../ui/Field.tsx";
import {
  type Option,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/Select.tsx";

type FormInputProps<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>> = Omit<
  TextInputProps,
  "value" | "onChangeText"
> & {
  control: Control<TFieldValues>;
  name: TName;
  label?: string;
  description?: string;
  fieldClassName?: string;
  hideError?: boolean;
  descriptionPosition?: "aboveInput" | "belowInput";
  values: Option[];
  placeholder?: string;
};

export const FormSelectInput = <
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({
  control,
  name,
  label,
  description,
  placeholder = "Select a value",
  fieldClassName = "",
  hideError = false,
  className,
  onBlur,
  onFocus,
  values,
  descriptionPosition = "aboveInput",
  ...props
}: FormInputProps<TFieldValues, TName>) => {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        return (
          <Field data-invalid={fieldState.invalid} className={cn(fieldClassName, className)}>
            {(label || description) && (
              <View className={cn("flex flex-col", descriptionPosition === "aboveInput" && "mb-2")}>
                {label && (
                  <FieldLabel className="text-lg font-medium" htmlFor={name}>
                    {label}
                  </FieldLabel>
                )}
                {description && <FieldDescription>{description}</FieldDescription>}
              </View>
            )}
            <Select
              {...props}
              value={{
                label: values.find((option) => option?.value === field.value)?.label ?? "",
                value: field.value,
              }}
              defaultValue={field.value}
              onValueChange={(option) => {
                field.onChange(option?.value ?? "N/A", {
                  shouldDirty: true,
                  shouldTouch: true,
                  shouldValidate: true,
                });
              }}
            >
              <SelectTrigger className="h-12 w-full rounded-xl bg-white border border-border">
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {values.map((value) => (
                    <SelectItem
                      key={value?.value}
                      label={value?.label ?? ""}
                      value={value?.value ?? ""}
                    >
                      {value?.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>

            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        );
      }}
    />
  );
};
