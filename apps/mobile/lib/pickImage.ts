import { tryCatch } from "@openbeacon/shared";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Alert } from "./alert.ts";
import { cleanupTempFile } from "./image-upload.ts";
import { withOwnScreen } from "./ownScreen.ts";

export const pickImage = async () => {
  const permissionResult = await withOwnScreen(ImagePicker.requestMediaLibraryPermissionsAsync);
  if (!permissionResult.granted) {
    Alert.alert("Permission required", "Permission to access the media library is required.");
    return null;
  }

  const result = await withOwnScreen(() =>
    ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
      allowsMultipleSelection: false,
      exif: false,
      shape: "oval",
    }),
  );
  if (result.canceled) return null;

  const photo = result.assets[0];
  if (!photo) {
    Alert.alert("No picture selected");
    return null;
  }
  return photo.uri;
};

export const processImage = async (uri: string) => {
  const result = await tryCatch(
    (async () => {
      const imageRef = await ImageManipulator.manipulate(uri)
        .resize({ width: 512, height: 512 })
        .renderAsync();
      const saved = await imageRef.saveAsync({ format: SaveFormat.WEBP, compress: 0.85 });
      return saved.uri;
    })(),
  );
  cleanupTempFile(uri);
  if (result.error) {
    Alert.alert("Unable to process that picture", result.error.message);
    return null;
  }
  return result.data;
};
