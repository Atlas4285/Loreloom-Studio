import { resolveLocale } from "../i18n/locale.ts";
export interface LocalizedName {
  en: string;
  "zh-CN": string;
}
export function isLocalizedName(value: unknown): value is LocalizedName {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const name = value as Record<string, unknown>;
  return (
    typeof name.en === "string" &&
    !!name.en.trim() &&
    typeof name["zh-CN"] === "string" &&
    !!name["zh-CN"].trim()
  );
}
export function localizedName(name: LocalizedName, locale: unknown): string {
  return name[resolveLocale(locale)];
}
