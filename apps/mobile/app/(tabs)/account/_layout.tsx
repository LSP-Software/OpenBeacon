import { Stack } from "expo-router";
import { useHeaderOptions } from "../../../components/headers/useHeaderOptions.ts";

const AccountLayout = () => <Stack screenOptions={useHeaderOptions()} />;

export default AccountLayout;
