import { message } from "../../../../../shared/i18n/message.ts";
import zhCN from "../../../../../locales/zh-CN.json";
export const DEFAULT_PROMPT = message(
  "loreloom.stateTrace.defaultPrompt",
  "Current character and scene state:\n\n{{state}}\n\nBefore each reply, check whether this round's events will change the state. If so, you must call {{toolName}} to update the state before generating the reply.\n\nUpdate only fields that actually change, and preserve all unchanged fields. Ensure the final narrative is consistent with the updated state. No tool call is needed when the state does not change.",
);
export function isDefaultPrompt(value: string | undefined): boolean {
  if (!value) return true;
  const normalize = (text: string) =>
    text
      .replaceAll(String.fromCodePoint(0xff1a), ":")
      .replaceAll(String.fromCodePoint(0xff0c), ",")
      .replaceAll(String.fromCodePoint(0x3002), ".")
      .replace(/\s+/g, "");
  return [
    DEFAULT_PROMPT.text,
    zhCN[DEFAULT_PROMPT.key as keyof typeof zhCN],
  ].some(
    (text) => typeof text === "string" && normalize(text) === normalize(value),
  );
}
