import { en } from "./locales/en.js";

/**
 * The few words and number formats the phone draws charts with. Hermes has no `Intl.PluralRules`,
 * which the kit's own word lists need, so these read the English messages directly.
 */
export const nativeWords = {
  number: (value: number, options?: Intl.NumberFormatOptions): string => {
    try {
      // Hermes ignores `notation: "compact"`, so large figures are shortened here.
      if (options?.notation === "compact") {
        const { notation: _notation, ...rest } = options;
        const scales = [
          [1e12, "T"],
          [1e9, "B"],
          [1e6, "M"],
          [1e3, "K"],
        ] as const;
        const scale = scales.find(([size]) => Math.abs(value) >= size);
        if (scale)
          return `${new Intl.NumberFormat(undefined, rest).format(value / scale[0])}${scale[1]}`;
      }
      return new Intl.NumberFormat(undefined, options).format(value);
    } catch {
      return String(value);
    }
  },
  t: (key: "pros" | "cons" | "other"): string => en[key],
};
