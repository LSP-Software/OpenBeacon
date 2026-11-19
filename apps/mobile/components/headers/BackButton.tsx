import { type Href, router, usePathname } from "expo-router";
import { ArrowLeftIcon } from "lucide-react-native";
import { Pressable } from "react-native";
import { Icon } from "../ui/Icon.tsx";

export const BackButton = ({ fallback }: { fallback?: Href }) => {
  const pathname = usePathname();
  const parent: Href =
    fallback ?? (pathname.startsWith("/account/") ? "/(tabs)/account/overview" : "/");
  return (
    <Pressable
      className="size-11 items-center justify-center rounded-full active:bg-secondary"
      onPress={() => (router.canGoBack() ? router.back() : router.replace(parent))}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <Icon as={ArrowLeftIcon} className="size-6 text-foreground" />
    </Pressable>
  );
};
