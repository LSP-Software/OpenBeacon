import { Host as ComposeHost } from "@expo/ui/jetpack-compose";
import { Host as SwiftHost } from "@expo/ui/swift-ui";
import type { ComponentProps } from "react";
import { useAppTheme } from "../../providers/ThemeProvider.tsx";

export const AndroidHost = (props: ComponentProps<typeof ComposeHost>) => (
  <ComposeHost colorScheme={useAppTheme()} {...props} />
);

export const IosHost = (props: ComponentProps<typeof SwiftHost>) => (
  <SwiftHost colorScheme={useAppTheme()} {...props} />
);
