const { AndroidConfig, createRunOncePlugin } = require("expo/config-plugins");

const PACKAGE_NAME = "openbeacon-tracking";

const withOpenBeaconTracking = (config) =>
  AndroidConfig.Permissions.withPermissions(config, [
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_LOCATION",
    "android.permission.POST_NOTIFICATIONS",
  ]);

module.exports = createRunOncePlugin(withOpenBeaconTracking, PACKAGE_NAME, "0.0.0");
