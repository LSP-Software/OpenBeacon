import type { LiveMapMarker } from "./buildLiveMapMarkers.ts";

export const applySelfDeviceLocation = ({
  markers,
  selfDeviceLocation,
  selfFallback,
  selfUserId,
}: {
  markers: readonly LiveMapMarker[];
  selfDeviceLocation: {
    latitude: number;
    longitude: number;
    timestamp: string;
  } | null;
  selfFallback: {
    image: string | null;
    name: string;
    otherSharedGroupNames: string[];
    ringColor: string;
    sourceGroupId: string;
  } | null;
  selfUserId: string;
}): LiveMapMarker[] => {
  if (!selfDeviceLocation || selfUserId.length === 0) {
    return [...markers];
  }

  const selfIndex = markers.findIndex((marker) => marker.userId === selfUserId);
  if (selfIndex >= 0) {
    return markers.map((marker, index) => {
      if (index !== selfIndex) {
        return marker;
      }

      return {
        ...marker,
        latitude: selfDeviceLocation.latitude,
        longitude: selfDeviceLocation.longitude,
        timestamp: selfDeviceLocation.timestamp,
      };
    });
  }

  if (!selfFallback) {
    return [...markers];
  }

  return [
    ...markers,
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
