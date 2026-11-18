import {
  decodeJsonPayload,
  decryptPayloadWithEpochKey,
  encodePlaceGeometryV1,
  encryptPayloadWithEpochKey,
  type EpochKeyMaterial,
  PAYLOAD_ENCRYPTION_ALGORITHM,
  PLACE_GEOMETRY_KIND,
  type PlaceGeometryV1,
  validatePlaceGeometryV1,
} from "@openbeacon/encryption";
import type { ErrorReason } from "@openbeacon/shared";
import type { RouterOutputs } from "./api.ts";

export type GroupPlace = RouterOutputs["groupPlaces"]["list"]["places"][number] & {
  geometry: PlaceGeometryV1 | null;
};

export const PLACE_RADIUS_MIN = 100;
export const PLACE_RADIUS_MAX = 1000;
export const PLACE_RADIUS_DEFAULT = 250;

export const PLACE_SIZE_STOPS = [
  { label: "Small", radiusMeters: 100 },
  { label: "Medium", radiusMeters: 250 },
  { label: "Large", radiusMeters: 500 },
] as const;

export const PLACE_EMOJI_CHOICES = [
  "🏠",
  "🏫",
  "🏢",
  "⚽",
  "🛒",
  "🏥",
  "🏋️",
  "🌳",
  "☕",
  "🎓",
  "🚉",
  "⭐",
] as const;

export const snapPlaceRadius = (meters: number) =>
  Math.min(PLACE_RADIUS_MAX, Math.max(PLACE_RADIUS_MIN, Math.round(meters / 25) * 25));

export const placeRadiusFromSlider = (fraction: number) =>
  snapPlaceRadius(PLACE_RADIUS_MIN + fraction * (PLACE_RADIUS_MAX - PLACE_RADIUS_MIN));

export const sliderFromPlaceRadius = (radiusMeters: number) =>
  (snapPlaceRadius(radiusMeters) - PLACE_RADIUS_MIN) / (PLACE_RADIUS_MAX - PLACE_RADIUS_MIN);

export const formatPlaceDistance = (meters: number) =>
  meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;

export const formatPlaceSize = (radiusMeters: number) => {
  const stop = PLACE_SIZE_STOPS.find((item) => item.radiusMeters === radiusMeters);
  const distance = formatPlaceDistance(radiusMeters);
  return stop ? `${stop.label} · ${distance}` : distance;
};

export const metersBetween = (
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) => {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
};

export const isPlaceEditUnchanged = ({ before, after }: { before: PlaceEdit; after: PlaceEdit }) =>
  before.name === after.name &&
  before.emoji === after.emoji &&
  before.geometry.radiusMeters === after.geometry.radiusMeters &&
  metersBetween(before.geometry, after.geometry) < 1;

export const metersPerPixel = ({ latitude, zoom }: { latitude: number; zoom: number }) =>
  (78_271.516_964 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;

export const shiftLatitudeByPixels = ({
  latitude,
  pixels,
  zoom,
}: {
  latitude: number;
  pixels: number;
  zoom: number;
}) =>
  Math.min(85, Math.max(-85, latitude + (pixels * metersPerPixel({ latitude, zoom })) / 111_320));

export const zoomToFitPlace = ({
  diameterPixels,
  latitude,
  radiusMeters,
}: {
  diameterPixels: number;
  latitude: number;
  radiusMeters: number;
}) => Math.log2((metersPerPixel({ latitude, zoom: 0 }) * diameterPixels) / (2 * radiusMeters));

export const placeCirclePolygon = ({ latitude, longitude, radiusMeters }: PlaceGeometryV1) => {
  const steps = 64;
  const latitudeDegrees = radiusMeters / 111_320;
  const longitudeDegrees = latitudeDegrees / Math.max(Math.cos((latitude * Math.PI) / 180), 0.01);
  const ring = Array.from({ length: steps + 1 }, (_, index): [number, number] => {
    const angle = ((index % steps) / steps) * 2 * Math.PI;
    return [
      longitude + longitudeDegrees * Math.cos(angle),
      latitude + latitudeDegrees * Math.sin(angle),
    ];
  });
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Polygon" as const, coordinates: [ring] },
  };
};

export const peopleAtPlace = <
  T extends { latitude: number; longitude: number; timestamp: string; userId: string },
>({
  geometry,
  now,
  people,
}: {
  geometry: PlaceGeometryV1;
  now: number;
  people: readonly T[];
}) => {
  const freshSince = now - 20 * 60_000;
  const here = people.filter(
    (person) =>
      Date.parse(person.timestamp) >= freshSince &&
      metersBetween(geometry, person) <= geometry.radiusMeters,
  );
  return [...new Map(here.map((person) => [person.userId, person])).values()];
};

export const describePeopleHere = (names: readonly string[]) => {
  const [first, second] = names;
  if (first === undefined) return "Nobody here now";
  if (second === undefined) return `${first} is here`;
  if (names.length === 2) return `${first} and ${second} are here`;
  return `${first}, ${second} and ${names.length - 2} more are here`;
};

export type MapPlace = {
  canManage: boolean;
  emoji: string;
  groupId: string;
  groupName: string;
  id: string;
  latitude: number;
  longitude: number;
  memberUserIds: readonly string[];
  name: string;
  radiusMeters: number;
};

export const buildPlacePins = ({
  groups,
  hiddenGroupIds,
}: {
  groups: readonly {
    canManage: boolean;
    id: string;
    memberUserIds: readonly string[];
    name: string;
    places: readonly GroupPlace[] | undefined;
  }[];
  hiddenGroupIds: ReadonlySet<string>;
}): MapPlace[] =>
  groups
    .filter((group) => !hiddenGroupIds.has(group.id))
    .flatMap((group) =>
      (group.places ?? []).flatMap((place) =>
        place.geometry
          ? [
              {
                canManage: group.canManage,
                emoji: place.emoji,
                groupId: group.id,
                groupName: group.name,
                id: place.id,
                latitude: place.geometry.latitude,
                longitude: place.geometry.longitude,
                memberUserIds: group.memberUserIds,
                name: place.name,
                radiusMeters: place.geometry.radiusMeters,
              },
            ]
          : [],
      ),
    );

export const hiddenGroupWithPlace = <
  T extends { id: string; places: readonly { id: string }[] | undefined },
>({
  groups,
  hiddenGroupIds,
  placeId,
}: {
  groups: readonly T[];
  hiddenGroupIds: ReadonlySet<string>;
  placeId: string;
}) =>
  groups.find(
    (group) =>
      hiddenGroupIds.has(group.id) && (group.places ?? []).some((place) => place.id === placeId),
  ) ?? null;

export const encryptPlaceGeometry = ({
  epochId,
  epochKey,
  geometry,
  groupId,
  senderDeviceId,
}: {
  epochId: string;
  epochKey: EpochKeyMaterial;
  geometry: PlaceGeometryV1;
  groupId: string;
  senderDeviceId: string;
}) => {
  const encrypted = encryptPayloadWithEpochKey({
    epochKey,
    metadata: { epochId, groupId, kind: PLACE_GEOMETRY_KIND, senderDeviceId },
    plaintext: encodePlaceGeometryV1(geometry),
  });
  return {
    algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
    ciphertext: encrypted.ciphertext,
    epochId,
    kind: PLACE_GEOMETRY_KIND,
    nonce: encrypted.nonce,
    senderDeviceId,
  };
};

export const decryptPlaceGeometry = ({
  epochKey,
  groupId,
  place,
}: {
  epochKey: EpochKeyMaterial;
  groupId: string;
  place: {
    algorithm: string;
    ciphertext: string;
    createdAt: Date;
    epochId: string;
    kind: string;
    nonce: string;
    senderDeviceId: string;
  };
}) => {
  if (place.algorithm !== PAYLOAD_ENCRYPTION_ALGORITHM || place.kind !== PLACE_GEOMETRY_KIND) {
    return null;
  }
  const metadata = {
    epochId: place.epochId,
    groupId,
    kind: PLACE_GEOMETRY_KIND,
    senderDeviceId: place.senderDeviceId,
  };
  try {
    const decrypted = decryptPayloadWithEpochKey({
      encryptedPayload: { ...metadata, ...place, algorithm: PAYLOAD_ENCRYPTION_ALGORITHM },
      epochKey,
      expectedMetadata: metadata,
    });
    return validatePlaceGeometryV1(decodeJsonPayload(decrypted.bytes));
  } catch {
    return null;
  }
};

export const placeErrorMessage = (reason: ErrorReason | null, fallback: string) => {
  if (reason === "PLACE_CHANGED")
    return "Someone else just changed this place. Check it and try again.";
  if (reason === "PLACE_GONE") return "This place has been deleted.";
  if (reason === "EPOCH_ROTATION_PENDING" || reason === "EPOCH_NOT_LATEST") {
    return "This group’s keys are changing. Try again in a moment.";
  }
  return fallback;
};

type PlaceEdit = {
  name: string;
  emoji: string;
  geometry: { latitude: number; longitude: number; radiusMeters: number };
};
