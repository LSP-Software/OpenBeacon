import { UserIcon } from "lucide-react-native";
import { View } from "react-native";
import { SettingsContainer } from "../../../../components/containers/settingsContainer.tsx";

const SettingsTab = () => {
  const categories = [
    {
      label: "Heading 1",
      settings: [
        {
          label: "example setting 1",
          icon: UserIcon,
          href: "/groups/[groupId]/settings/group-name",
        },
        {
          label: "example setting 2",
          icon: UserIcon,
          href: "/groups/[groupId]/settings/group-name",
        },
        {
          label: "example setting 3",
          icon: UserIcon,
          href: "/groups/[groupId]/settings/group-name",
        },
      ],
    },
    {
      label: "Heading 2",
      settings: [
        {
          label: "example setting 4",
          icon: UserIcon,
          href: "/groups/[groupId]/settings/group-name",
        },
        {
          label: "example setting 5",
          icon: UserIcon,
          href: "/groups/[groupId]/settings/group-name",
        },
      ],
    },
  ];

  return (
    <View className="pt-1">
      <SettingsContainer categories={categories} />
    </View>
  );
};

export default SettingsTab;
