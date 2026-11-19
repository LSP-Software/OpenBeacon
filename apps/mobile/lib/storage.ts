import { createMMKV } from "react-native-mmkv";

export const storage = createMMKV({ id: "openbeacon" });

if (storage.getNumber("storage.schemaVersion") === undefined) {
  storage.set("storage.schemaVersion", 1);
}
