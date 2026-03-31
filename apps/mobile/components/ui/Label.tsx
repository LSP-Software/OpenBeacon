import * as LabelPrimitive from "@rn-primitives/label";
import { cn } from "../../lib/cn.ts";

const Label = ({
  className,
  disabled,
  ...rest
}: LabelPrimitive.TextProps & React.RefAttributes<LabelPrimitive.TextRef>) => {
  return (
    <LabelPrimitive.Text
      className={cn("text-foreground text-sm font-medium", className, disabled && "opacity-50")}
      disabled={disabled}
      {...rest}
    />
  );
};

export { Label };
