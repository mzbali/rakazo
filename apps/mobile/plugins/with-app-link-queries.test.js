import { expect, it } from "vitest";
import { addAppLinkQueries } from "./with-app-link-queries.js";

const view = (scheme) => ({
  action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
  data: [{ $: { "android:scheme": scheme } }],
});

it("lets the app ask Android whether each listed scheme can open", () => {
  expect(addAppLinkQueries({}, ["coder"]).queries).toEqual([{ intent: [view("coder")] }]);
});

it("keeps queries already declared and adds each scheme once", () => {
  const settings = { action: [{ $: { "android:name": "android.settings.SETTINGS" } }] };
  const manifest = { queries: [{ intent: [settings, view("coder")] }] };
  expect(addAppLinkQueries(manifest, ["coder", "other"]).queries).toEqual([
    { intent: [settings, view("coder"), view("other")] },
  ]);
});

it("adds nothing when no scheme is listed", () => {
  expect(addAppLinkQueries({}, [])).toEqual({});
});
