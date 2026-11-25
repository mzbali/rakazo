import type { AppLink } from "./app-links.js";

/**
 * The apps chat links may open, one entry per app. A user picks these by name, so they are
 * product data. Each surface allows the ones it can open, and the iPhone app declares every
 * scheme here so iOS answers whether it can open it. Every entry has a name and an icon, which
 * is what lets its links draw as an "Open in {name}" pill.
 */
export const appLinkCatalog: readonly (AppLink & { name: string; icon: string })[] = [
  // Coding agents link back to their threads.
  { scheme: "t3code", host: "threads", name: "T3", icon: "https://app.t3.codes" },
  // A mail message or inbox; `accountId` picks which signed-in account shows it.
  {
    scheme: "googlegmail",
    host: "",
    name: "Gmail",
    icon: "https://mail.google.com",
    queryKeys: ["accountId"],
    iosOnly: true,
  },
];
