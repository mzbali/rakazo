import type { AppLink } from "@rakazo/core/app-links";

/**
 * App places chat links may open. Coding agents link back to their threads in the T3 Code app.
 * iOS answers whether a scheme can open only for the ones in app.json's LSApplicationQueriesSchemes.
 */
export const mobileAppLinks: AppLink[] = [{ scheme: "t3code", host: "threads" }];
