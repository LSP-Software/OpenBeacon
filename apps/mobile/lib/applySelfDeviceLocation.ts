import { initialsFromName, type LiveMapMarker } from "./buildLiveMapMarkers.ts";
import type { SelfDeviceLocation } from "./selfDeviceLocation.ts";

export const applySelfDeviceLocation = ({
  markers,
  selfDeviceId,
  selfDeviceLocation,
  selfFallback,
  selfUserId,
  lastSentAt,
}: {
  markers: readonly LiveMapMarker[];
  selfDeviceId: string;
  selfDeviceLocation: SelfDeviceLocation | null;
  selfFallback: {
    image: string | null;
    name: string;
    otherSharedGroupNames: string[];
    ringColor: string;
    ringColors?: string[];
    sourceGroupId: string;
  } | null;
  selfUserId: string;
  lastSentAt: string | null;
}): LiveMapMarker[] => {
  const others =
    selfDeviceId.length === 0
      ? [...markers]
      : markers.filter((marker) => marker.deviceId !== selfDeviceId);

  if (
    !selfDeviceLocation ||
    selfUserId.length === 0 ||
    selfDeviceId.length === 0 ||
    !selfFallback
  ) {
    return others;
  }

  return [
    ...others,
    {
      battery: null,
      deviceId: selfDeviceId,
      image: selfFallback.image,
      initials: initialsFromName(selfFallback.name),
      isSelf: true,
      latitude: selfDeviceLocation.latitude,
      longitude: selfDeviceLocation.longitude,
      name: selfFallback.name,
      otherSharedGroupNames: [...selfFallback.otherSharedGroupNames],
      ringColor: selfFallback.ringColor,
      ...(selfFallback.ringColors ? { ringColors: selfFallback.ringColors } : {}),
      sourceGroupId: selfFallback.sourceGroupId,
      timestamp: lastSentAt,
      userId: selfUserId,
    },
  ];
};
