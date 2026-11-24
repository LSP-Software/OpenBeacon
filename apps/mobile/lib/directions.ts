import { tryCatch } from "@openbeacon/shared";
import { Linking, Platform } from "react-native";

export type DirectionsApp = "apple" | "google" | "waze" | "other";

const directionsApps: readonly {
  app: DirectionsApp;
  name: string;
  platform: "android" | "ios";
  probe: string | null;
  url: (destination: string) => string;
}[] = [
  {
    app: "apple",
    name: "Apple Maps",
    platform: "ios",
    probe: null,
    url: (destination) => `maps://?daddr=${destination}`,
  },
  {
    app: "google",
    name: "Google Maps",
    platform: "ios",
    probe: "comgooglemaps://",
    url: (destination) => `comgooglemaps://?daddr=${destination}&directionsmode=driving`,
  },
  {
    app: "google",
    name: "Google Maps",
    platform: "android",
    probe: "google.navigation:q=0,0",
    url: (destination) => `google.navigation:q=${destination}`,
  },
  {
    app: "waze",
    name: "Waze",
    platform: "ios",
    probe: "waze://",
    url: (destination) => `waze://?ll=${destination}&navigate=yes`,
  },
  {
    app: "waze",
    name: "Waze",
    platform: "android",
    probe: "waze://",
    url: (destination) => `waze://?ll=${destination}&navigate=yes`,
  },
  {
    app: "other",
    name: "Another maps app",
    platform: "android",
    probe: "geo:0,0",
    url: (destination) => `geo:${destination}?q=${destination}`,
  },
];

export const directionsAppKey = "directions.app";

export const parseDirectionsApp = (value: string | undefined): DirectionsApp | null =>
  value === "apple" || value === "google" || value === "waze" || value === "other" ? value : null;

const appsForPlatform = () => directionsApps.filter((option) => option.platform === Platform.OS);

export const directionsAppName = (app: DirectionsApp) =>
  appsForPlatform().find((option) => option.app === app)?.name ?? "your maps app";

export const directionsUrl = (
  app: DirectionsApp,
  { latitude, longitude }: { latitude: number; longitude: number },
) => {
  const option = appsForPlatform().find((candidate) => candidate.app === app);
  return option ? option.url(`${latitude.toFixed(6)},${longitude.toFixed(6)}`) : null;
};

export const installedDirectionsApps = async () => {
  const installed = await Promise.all(
    appsForPlatform().map(async (option) => {
      if (option.probe === null) return option;
      const canOpen = await tryCatch(Linking.canOpenURL(option.probe));
      return canOpen.data ? option : null;
    }),
  );
  return installed
    .filter((option) => option !== null)
    .map((option) => ({ app: option.app, name: option.name }));
};

export const openDirections = async (
  app: DirectionsApp,
  destination: { latitude: number; longitude: number },
) => {
  const url = directionsUrl(app, destination);
  if (url === null) return false;
  const opened = await tryCatch(Linking.openURL(url));
  return !opened.error;
};
