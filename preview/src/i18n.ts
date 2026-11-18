import zhCN from "../../locales/zh-CN.json";
import { translateMessage, type Message } from "../../shared/i18n/message";

export type { Locale } from "../../shared/i18n/locale";

export function translate(
  locale: string,
  source: Message,
  values: Record<string, string | number> = {},
): string {
  return translateMessage(source, locale === "zh-CN" ? zhCN : {}, values);
}
