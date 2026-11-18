import { appLinkCatalog } from "@rakazo/core/app-links";
import { Platform } from "react-native";

/**
 * App places chat links may open on this phone: the catalog, less apps that take their links
 * only on iPhone when this is Android. iOS and Android answer whether a scheme can open only for
 * the ones in app.json's LSApplicationQueriesSchemes (plugins/with-app-link-queries copies them
 * to Android).
 */
export const mobileAppLinks = appLinkCatalog.filter(
  (link) => !link.iosOnly || Platform.OS === "ios",
);
