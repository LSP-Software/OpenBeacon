import * as LabelPrimitive from "@rn-primitives/label";
import { cn } from "../../lib/cn.ts";

const Label = ({
  className,
  ...props
}: LabelPrimitive.TextProps & React.RefAttributes<LabelPrimitive.TextRef>) => {
  return (
    <LabelPrimitive.Text
      className={cn("text-foreground text-sm font-medium", className)}
      {...props}
    />
  );
};

export { Label };
