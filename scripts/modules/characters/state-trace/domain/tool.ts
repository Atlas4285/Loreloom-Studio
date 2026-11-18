import { message } from "../../../../../shared/i18n/message.ts";
import zhCN from "../../../../../locales/zh-CN.json";

export const DEFAULT_TOOL_DESCRIPTION = message(
  "loreloom.stateTrace.toolDescription",
  "Update character or scene state based on this round's events. Submit only changed fields and their new values; multiple fields may be updated together. Keep omitted fields unchanged. Do not record changes that have not occurred or are not yet certain.",
);

export function isDefaultToolDescription(value: string | undefined): boolean {
  return (
    !value?.trim() ||
    value === DEFAULT_TOOL_DESCRIPTION.text ||
    value === zhCN[DEFAULT_TOOL_DESCRIPTION.key as keyof typeof zhCN]
  );
}
