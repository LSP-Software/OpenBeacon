import { Stack } from "expo-router";
import { useHeaderOptions } from "../../../components/headers/useHeaderOptions.ts";

export const unstable_settings = { initialRouteName: "list" };

const GroupsLayout = () => <Stack screenOptions={useHeaderOptions()} />;

export default GroupsLayout;
