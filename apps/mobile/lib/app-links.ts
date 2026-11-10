import type { AppLink } from "@rakazo/core/app-links";

/**
 * App places chat links may open. Coding agents link back to their threads in the T3 Code app.
 * iOS and Android answer whether a scheme can open only for the ones in app.json's
 * LSApplicationQueriesSchemes (plugins/with-app-link-queries copies them to Android).
 */
export const mobileAppLinks: AppLink[] = [
  { scheme: "t3code", host: "threads", icon: "https://app.t3.codes" },
];
