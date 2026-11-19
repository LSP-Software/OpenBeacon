import { expect, mock, test } from "bun:test";

const alerts: string[] = [];
mock.module("react-native", () => ({ Platform: { OS: "android" } }));
mock.module("expo-image-manipulator", () => ({ ImageManipulator: {}, SaveFormat: {} }));
mock.module("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: async () => ({ granted: false }),
  launchImageLibraryAsync: async () => ({
    canceled: false,
    assets: [{ uri: "file:///picked.jpg" }],
  }),
}));
mock.module("./alert.ts", () => ({ Alert: { alert: (title: string) => alerts.push(title) } }));
mock.module("./image-upload.ts", () => ({ cleanupTempFile: () => {} }));

const { pickImage } = await import("./pickImage.ts");

test("picking a picture uses the system picker without asking for storage access", async () => {
  expect(await pickImage()).toBe("file:///picked.jpg");
  expect(alerts).toEqual([]);
});
