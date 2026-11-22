import { describe, expect, test } from "bun:test";
import { getPalette, hexToRgbChannels, paletteCssVariables } from "./palette.ts";

const luminance = (hex: string) => {
  const channels = hexToRgbChannels(hex)
    .split(" ")
    .map((value) => Number(value) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  const [red = 0, green = 0, blue = 0] = channels;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrast = (first: string, second: string) => {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
};

const variants = (["ios", "android"] as const).flatMap((platform) =>
  (["light", "dark"] as const).map((theme) => ({ platform, theme })),
);

describe("palette", () => {
  test("turns hex colours into the rgb channels Tailwind reads", () => {
    expect(hexToRgbChannels("#E6005C")).toBe("230 0 92");
    expect(paletteCssVariables(getPalette("ios", "light"))["--action"]).toBe("230 0 92");
  });

  for (const { platform, theme } of variants) {
    test(`${platform} ${theme} text is readable on screens, cards and rows`, () => {
      const palette = getPalette(platform, theme);
      for (const surface of [palette.background, palette.card]) {
        for (const text of [
          palette.foreground,
          palette["text-secondary"],
          palette["text-tertiary"],
          palette["primary-text"],
          palette["destructive-text"],
        ]) {
          expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(contrast(palette["secondary-foreground"], palette.secondary)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(
        contrast(palette["primary-soft-foreground"], palette["primary-soft"]),
      ).toBeGreaterThanOrEqual(4.5);
      expect(contrast("#FFFFFF", palette.action)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
