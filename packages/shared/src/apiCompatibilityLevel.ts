export const apiCompatibilityLevel = 3;
export const minClientApiCompatibilityLevel = 3;
export const minServerApiCompatibilityLevel = 3;

export const apiCompatibilityLevelHeader = "x-openbeacon-api-compatibility-level";
export const minClientApiCompatibilityLevelHeader =
  "x-openbeacon-min-client-api-compatibility-level";

export const parseApiCompatibilityLevel = (value: unknown) => {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === "string" && /^\d{1,9}$/.test(value)) {
    return Number(value);
  }
  return null;
};
