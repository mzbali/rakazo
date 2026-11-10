// Android 11+ answers `Linking.canOpenURL` only for apps the manifest declares it may see. The
// chat link opener asks first, so each scheme iOS lists in LSApplicationQueriesSchemes gets the
// same ACTION_VIEW query here: one list for both platforms.
const { withAndroidManifest } = require("expo/config-plugins");

function addAppLinkQueries(manifest, schemes) {
  if (schemes.length === 0) return manifest;
  manifest.queries ??= [{}];
  const queries = manifest.queries[0];
  queries.intent ??= [];
  const intents = queries.intent;
  for (const scheme of schemes) {
    const declared = intents.some((intent) =>
      intent.data?.some((data) => data.$?.["android:scheme"] === scheme),
    );
    if (declared) continue;
    intents.push({
      action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
      data: [{ $: { "android:scheme": scheme } }],
    });
  }
  return manifest;
}

function withAppLinkQueries(config) {
  const schemes = config.ios?.infoPlist?.LSApplicationQueriesSchemes ?? [];
  return withAndroidManifest(config, (cfg) => {
    addAppLinkQueries(cfg.modResults.manifest, schemes);
    return cfg;
  });
}

module.exports = withAppLinkQueries;
module.exports.addAppLinkQueries = addAppLinkQueries;
