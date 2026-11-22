import { Stack } from "expo-router";
import { useHeaderOptions } from "../../../components/headers/useHeaderOptions.ts";

const MapLayout = () => <Stack screenOptions={useHeaderOptions()} />;

export default MapLayout;
