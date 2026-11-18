import { appLinkCatalog } from "@rakazo/core/app-links";

/**
 * App places chat links may open: every app in the catalog. iOS and Android answer whether a
 * scheme can open only for the ones in app.json's LSApplicationQueriesSchemes
 * (plugins/with-app-link-queries copies them to Android).
 */
export const mobileAppLinks = appLinkCatalog;
