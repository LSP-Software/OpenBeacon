export const PLACE_GEOMETRY_KIND = "placeGeometry" as const;

export type PlaceGeometryV1 = {
  v: 1;
  latitude: number;
  longitude: number;
  radiusMeters: number;
};

const textEncoder = new TextEncoder();

export const validatePlaceGeometryV1 = (value: unknown): PlaceGeometryV1 => {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.keys(value).length !== 4 ||
    !("v" in value) ||
    value.v !== 1 ||
    !("latitude" in value) ||
    typeof value.latitude !== "number" ||
    !Number.isFinite(value.latitude) ||
    value.latitude < -90 ||
    value.latitude > 90 ||
    !("longitude" in value) ||
    typeof value.longitude !== "number" ||
    !Number.isFinite(value.longitude) ||
    value.longitude < -180 ||
    value.longitude > 180 ||
    !("radiusMeters" in value) ||
    typeof value.radiusMeters !== "number" ||
    !Number.isInteger(value.radiusMeters) ||
    value.radiusMeters < 100 ||
    value.radiusMeters > 1000 ||
    value.radiusMeters % 25 !== 0
  ) {
    throw new Error("Invalid place geometry.");
  }

  return {
    v: 1,
    latitude: value.latitude,
    longitude: value.longitude,
    radiusMeters: value.radiusMeters,
  };
};

export const encodePlaceGeometryV1 = (placeGeometry: PlaceGeometryV1) =>
  textEncoder.encode(JSON.stringify(validatePlaceGeometryV1(placeGeometry)));
