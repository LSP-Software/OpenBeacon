import type { LiveMapMarker } from "./buildLiveMapMarkers.ts";
import type { SelfDeviceLocation } from "./selfDeviceLocation.ts";

export const applySelfDeviceLocation = ({
  markers,
  selfDeviceLocation,
  selfFallback,
  selfUserId,
}: {
  markers: readonly LiveMapMarker[];
  selfDeviceLocation: SelfDeviceLocation | null;
  selfFallback: {
    image: string | null;
    name: string;
    otherSharedGroupNames: string[];
    ringColor: string;
    sourceGroupId: string;
  } | null;
  selfUserId: string;
}): LiveMapMarker[] => {
  const others =
    selfUserId.length === 0
      ? [...markers]
      : markers.filter((marker) => marker.userId !== selfUserId);

  if (!selfDeviceLocation || selfUserId.length === 0 || !selfFallback) {
    return others;
  }

  return [
    ...others,
    {
      battery: null,
      image: selfFallback.image,
      initials: initialsFromName(selfFallback.name),
      isSelf: true,
      latitude: selfDeviceLocation.latitude,
      longitude: selfDeviceLocation.longitude,
      name: selfFallback.name,
      otherSharedGroupNames: [...selfFallback.otherSharedGroupNames],
      ringColor: selfFallback.ringColor,
      sourceGroupId: selfFallback.sourceGroupId,
      timestamp: selfDeviceLocation.timestamp,
      userId: selfUserId,
    },
  ];
};

const initialsFromName = (name: string) => {
  const initials = name.charAt(0) + name.charAt(1);
  return initials.length === 2 ? initials : "??";
};
