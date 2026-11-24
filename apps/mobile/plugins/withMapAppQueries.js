const { withAndroidManifest } = require("expo/config-plugins");

const MAP_APP_SCHEMES = ["google.navigation", "waze", "geo"];

const intentFor = (scheme) => ({
  action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
  data: [{ $: { "android:scheme": scheme } }],
});

const hasScheme = (queries, scheme) =>
  queries.some((query) =>
    (query.intent ?? []).some((intent) =>
      (intent.data ?? []).some((data) => data.$["android:scheme"] === scheme),
    ),
  );

const addMapAppQueries = (manifest) => {
  const queries = manifest.manifest.queries ?? [];
  const missing = MAP_APP_SCHEMES.filter((scheme) => !hasScheme(queries, scheme));
  if (missing.length === 0) return manifest;
  return {
    ...manifest,
    manifest: {
      ...manifest.manifest,
      queries: [...queries, { intent: missing.map(intentFor) }],
    },
  };
};

const withMapAppQueries = (config) =>
  withAndroidManifest(config, (mod) => {
    mod.modResults = addMapAppQueries(mod.modResults);
    return mod;
  });

withMapAppQueries.addMapAppQueries = addMapAppQueries;

module.exports = withMapAppQueries;
