const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withInfoPlist,
} = require("expo/config-plugins");

const PACKAGE_NAME = "openbeacon-tracking";

const withNoDeviceTransfer = (config) =>
  withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.$["android:dataExtractionRules"] = "@xml/openbeacon_data_extraction_rules";
    delete application.$["android:fullBackupContent"];
    return mod;
  });

const withOpenBeaconTracking = (config) =>
  withInfoPlist(
    withNoDeviceTransfer(
      AndroidConfig.Permissions.withPermissions(config, [
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.FOREGROUND_SERVICE_LOCATION",
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.RECEIVE_BOOT_COMPLETED",
      ]),
    ),
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
