import { en } from "./locales/en.js";

/**
 * The few words and number formats the phone draws charts with. Hermes has no `Intl.PluralRules`,
 * which the kit's own word lists need, so these read the English messages directly.
 */
export const nativeWords = {
  number: (value: number, options?: Intl.NumberFormatOptions): string => {
    try {
      return new Intl.NumberFormat(undefined, options).format(value);
    } catch {
      return String(value);
    }
  },
  t: (key: "pros" | "cons" | "other"): string => en[key],
};
