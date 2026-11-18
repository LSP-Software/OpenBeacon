import * as TabsPrimitive from "@rn-primitives/tabs";
import { cn } from "../../lib/cn.ts";
import { TextClassContext } from "./Text.tsx";

function Tabs({
  className,
  ...props
}: TabsPrimitive.RootProps & React.RefAttributes<TabsPrimitive.RootRef>) {
  return <TabsPrimitive.Root className={cn("flex flex-col gap-2", className)} {...props} />;
}

function TabsList({
  className,
  ...props
}: TabsPrimitive.ListProps & React.RefAttributes<TabsPrimitive.ListRef>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "bg-secondary mr-auto flex h-12 flex-row items-center justify-center rounded-xl p-1",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: TabsPrimitive.TriggerProps & React.RefAttributes<TabsPrimitive.TriggerRef>) {
  const { value } = TabsPrimitive.useRootContext();
  return (
    <TextClassContext.Provider
      value={cn(
        "text-secondary text-sm font-medium",
        value === props.value && "text-foreground font-semibold",
      )}
    >
      <TabsPrimitive.Trigger
        className={cn(
          "flex h-full flex-row items-center justify-center gap-1.5 rounded-lg px-3",
          props.disabled && "opacity-50",
          props.value === value && "bg-card dark:bg-border-strong",
          className,
        )}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

function TabsContent({
  className,
  ...props
}: TabsPrimitive.ContentProps & React.RefAttributes<TabsPrimitive.ContentRef>) {
  return <TabsPrimitive.Content className={cn(className)} {...props} />;
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
