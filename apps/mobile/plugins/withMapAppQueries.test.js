const { describe, expect, test } = require("bun:test");
const { addMapAppQueries } = require("./withMapAppQueries.js");

const schemesIn = (manifest) =>
  manifest.manifest.queries.flatMap((query) =>
    (query.intent ?? []).flatMap((intent) =>
      (intent.data ?? []).map((data) => data.$["android:scheme"]),
    ),
  );

describe("withMapAppQueries", () => {
  test("lets the app see which maps apps can give directions", () => {
    expect(schemesIn(addMapAppQueries({ manifest: {} }))).toEqual([
      "google.navigation",
      "waze",
      "geo",
    ]);
  });

  test("keeps existing queries and adds nothing twice", () => {
    const browser = {
      intent: [
        {
          action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
          data: [{ $: { "android:scheme": "https" } }],
        },
      ],
    };
    const once = addMapAppQueries({ manifest: { queries: [browser] } });
    expect(once.manifest.queries[0]).toEqual(browser);
    expect(addMapAppQueries(once)).toEqual(once);
    expect(schemesIn(once)).toEqual(["https", "google.navigation", "waze", "geo"]);
  });
});
