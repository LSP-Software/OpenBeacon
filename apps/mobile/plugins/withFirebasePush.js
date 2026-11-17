const { AndroidConfig, withStringsXml } = require("expo/config-plugins");

const FIREBASE_RESOURCES = {
  FIREBASE_APP_ID: "openbeacon_firebase_app_id",
  FIREBASE_API_KEY: "openbeacon_firebase_api_key",
  FIREBASE_PROJECT_ID: "openbeacon_firebase_project_id",
  FIREBASE_SENDER_ID: "openbeacon_firebase_sender_id",
};

const applyFirebaseStrings = (strings, env) => {
  const values = Object.entries(FIREBASE_RESOURCES).map(([envName, name]) => ({
    name,
    value: env[envName]?.trim(),
  }));
  if (values.some(({ value }) => !value)) {
    return values.reduce(
      (contents, { name }) => AndroidConfig.Strings.removeStringItem(name, contents),
      strings,
    );
  }
  return AndroidConfig.Strings.setStringItem(
    values.map(({ name, value }) =>
      AndroidConfig.Resources.buildResourceItem({ name, value, translatable: false }),
    ),
    strings,
  );
};

const withFirebasePush = (config) =>
  withStringsXml(config, (mod) => {
    mod.modResults = applyFirebaseStrings(mod.modResults, process.env);
    return mod;
  });

module.exports = withFirebasePush;
module.exports.applyFirebaseStrings = applyFirebaseStrings;
module.exports.FIREBASE_ENV_NAMES = Object.keys(FIREBASE_RESOURCES);
