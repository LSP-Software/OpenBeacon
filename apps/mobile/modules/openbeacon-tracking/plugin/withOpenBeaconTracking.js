const { AndroidConfig, createRunOncePlugin, withInfoPlist } = require("expo/config-plugins");

const PACKAGE_NAME = "openbeacon-tracking";

const withOpenBeaconTracking = (config) =>
  withInfoPlist(
    AndroidConfig.Permissions.withPermissions(config, [
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_LOCATION",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.RECEIVE_BOOT_COMPLETED",
    ]),
    (mod) => {
      const sharingCheck = `${mod.ios?.bundleIdentifier ?? "net.openbeacon.app"}.sharing-check`;
      const backgroundModes = mod.modResults.UIBackgroundModes ?? [];
      const permittedTasks = mod.modResults.BGTaskSchedulerPermittedIdentifiers ?? [];
      mod.modResults.UIBackgroundModes = [...new Set([...backgroundModes, "location", "fetch"])];
      mod.modResults.BGTaskSchedulerPermittedIdentifiers = [
        ...new Set([...permittedTasks, sharingCheck]),
      ];
      return mod;
    },
  );

module.exports = createRunOncePlugin(withOpenBeaconTracking, PACKAGE_NAME, "0.0.0");
