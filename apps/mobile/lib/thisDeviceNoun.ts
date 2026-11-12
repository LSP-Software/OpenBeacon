import * as Device from "expo-device";

export const thisDeviceNoun = () =>
  Device.deviceType === Device.DeviceType.TABLET ? "tablet" : "phone";
