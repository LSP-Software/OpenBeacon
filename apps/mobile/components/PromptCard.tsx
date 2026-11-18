import type { LucideIcon } from "lucide-react-native";
import { View } from "react-native";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/Card.tsx";
import { Icon } from "./ui/Icon.tsx";
import { Text } from "./ui/Text.tsx";

export const PromptCard = ({
  icon,
  tone,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  tone: "primary" | "warning";
  title: string;
  description: string;
  children: React.ReactNode;
}) => (
  <Card>
    <CardHeader className="flex flex-row items-start gap-3">
      <View
        className={`size-10 items-center justify-center rounded-full ${tone === "warning" ? "bg-warning-accent/15" : "bg-primary-soft"}`}
      >
        <Icon
          as={icon}
          className={`size-5 ${tone === "warning" ? "text-warning-text" : "text-primary-text"}`}
        />
      </View>
      <View className="flex-1 gap-1.5">
        <CardTitle>
          <Text>{title}</Text>
        </CardTitle>
        <CardDescription>
          <Text className="text-secondary text-sm">{description}</Text>
        </CardDescription>
      </View>
    </CardHeader>
    <CardContent className="flex flex-row flex-wrap gap-2">{children}</CardContent>
  </Card>
);
