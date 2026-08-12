import { dictionary, isRtl, type UiLanguage } from "./dictionary";

export type { UiLanguage };
export { isRtl };

export function getDictionary(lang: UiLanguage) {
  return dictionary[lang];
}
