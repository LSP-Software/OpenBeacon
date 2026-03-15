export type ProtomapsStyleVariant = "light" | "dark";

const BASE_STYLE_URL = "https://api.protomaps.com/styles/v5";

export function getProtomapsStyleUrl(variant: ProtomapsStyleVariant): string | null {
  const apiKey = process.env.EXPO_PUBLIC_PROTOMAPS_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  return `${BASE_STYLE_URL}/${variant}/en.json?key=${encodeURIComponent(apiKey)}`;
}
