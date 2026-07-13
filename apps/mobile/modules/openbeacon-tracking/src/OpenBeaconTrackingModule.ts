import { NativeModule, requireNativeModule } from "expo";

declare class OpenBeaconTrackingModule extends NativeModule {}

export default requireNativeModule<OpenBeaconTrackingModule>("OpenBeaconTracking");
