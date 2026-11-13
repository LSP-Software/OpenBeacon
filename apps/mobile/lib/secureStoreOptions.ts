import * as SecureStore from "expo-secure-store";

export const getSecureStoreOptions = () => ({
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
});
