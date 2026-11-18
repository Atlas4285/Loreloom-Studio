export type Locale = "en" | "zh-CN";
export function resolveLocale(value: unknown): Locale {
  if (typeof value !== "string") return "en";
  const locale = value.replaceAll("_", "-").toLowerCase();
  if (
    locale === "zh" ||
    locale === "zh-cn" ||
    locale === "zh-sg" ||
    /^zh-hans(?:-|$)/.test(locale)
  )
    return "zh-CN";
  return "en";
}
