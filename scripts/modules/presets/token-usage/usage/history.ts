import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import type { UsageHost } from "../runtime/host.ts";
import type { UsageTracker } from "./tracker.ts";
import {
  contextLimit,
  hasRequestUsage,
  isUsageReference,
  isToolMessage,
  hasGenerationMetadata,
  messageUsageExtra,
  promptText,
  readRecordedApiUsage,
  readStoredUsage,
  record,
  type TokenUsage,
} from "../domain/usage.ts";
export function createHistory(
  context: ModuleContext,
  host: UsageHost,
  tracker: UsageTracker,
  isActive: () => boolean,
  onReady: () => void,
) {
  const values = new Map<number, TokenUsage>();
  let version = 0;
  let pending = false;
  let again = false;
  function clear(): void {
    version++;
    values.clear();
  }
  async function load(): Promise<void> {
    const revision = ++version;
    const current = host.current();
    const { chat, chatId } = current;
    const limit = contextLimit(current);
    const valid = () =>
      revision === version &&
      isActive() &&
      host.isCurrent() &&
      host.current().chat === chat &&
      host.current().chatId === chatId;
    if (!chatId || !valid()) return;
    let raw: unknown;
    try {
      raw = await host.prompts(chatId);
    } catch (error) {
      if (valid()) console.warn("Could not read saved prompts.", error);
    }
    if (!valid()) return;
    const prompts = new Map<number, Record<string, unknown>>();
    if (Array.isArray(raw))
      for (const item of raw) {
        const value = record(item);
        if (
          value &&
          typeof value.mesId === "number" &&
          Number.isSafeInteger(value.mesId)
        )
          prompts.set(value.mesId, value);
      }
    const ids = Array.from(
      context.host.document.querySelectorAll<HTMLElement>("#chat .mes[mesid]"),
      (element) => Number(element.getAttribute("mesid")),
    ).filter((id) => Number.isSafeInteger(id) && id >= 0);
    for (const id of ids) {
      if (!valid()) return;
      const message = chat[id];
      if (
        !message ||
        message.is_user ||
        (message.is_system && !isToolMessage(message))
      )
        continue;
      const extra = messageUsageExtra(message);
      if (hasRequestUsage(extra)) {
        const stored = readStoredUsage(extra, limit);
        if (stored) values.set(id, stored);
        else values.delete(id);
        continue;
      }
      if (
        isUsageReference(extra) ||
        message.is_system ||
        tracker.isGenerating(id)
      ) {
        values.delete(id);
        continue;
      }
      const stored = tracker.ignoresStored(id)
        ? undefined
        : readStoredUsage(extra, limit);
      if (stored) {
        values.set(id, stored);
        continue;
      }
      const api = tracker.ignoresStored(id)
        ? undefined
        : readRecordedApiUsage(extra);
      const text = message.mes;
      const swipe = message.swipe_id;
      const reasoning = message.extra?.reasoning;
      const prompt = prompts.get(id);
      const latest =
        !message.swipes?.length ||
        (message.swipe_id ?? 0) === message.swipes.length - 1;
      const saved =
        prompt && latest
          ? promptText(
              prompt.main_api !== "openai" &&
                typeof prompt.finalPrompt === "string"
                ? prompt.finalPrompt
                : prompt.rawPrompt,
            )
          : "";
      // Greetings and manually inserted assistant messages are not model output.
      // A saved request alone does not prove that a model response was received.
      if (!hasGenerationMetadata(message) && !api) {
        values.delete(id);
        continue;
      }
      const input =
        api?.input ??
        (await host.count(
          saved ||
            chat
              .slice(0, id)
              .map((item) => item?.mes ?? "")
              .join("\n"),
        ));
      const output =
        api?.output ??
        (await host.count(
          `${typeof reasoning === "string" ? reasoning : ""}${text ?? ""}`,
        ));
      if (!valid()) return;
      if (
        input === undefined ||
        output === undefined ||
        tracker.isGenerating(id) ||
        chat[id] !== message ||
        message.mes !== text ||
        message.swipe_id !== swipe ||
        message.extra?.reasoning !== reasoning
      )
        continue;
      values.set(id, {
        input,
        output,
        limit,
        total_tokens: api?.total ?? input + output,
        estimated:
          api?.input === undefined ||
          api.output === undefined ||
          api.total === undefined,
        inputSource: api?.input === undefined ? "tokenizer" : "api",
        outputSource: api?.output === undefined ? "tokenizer" : "api",
        totalSource: api?.total === undefined ? "tokenizer" : "api",
      });
    }
    if (valid()) onReady();
  }
  function refresh(): void {
    if (!isActive() || !host.isCurrent()) return;
    if (pending) {
      again = true;
      return;
    }
    pending = true;
    void load()
      .catch((error) => {
        if (host.isCurrent())
          console.warn("Could not refresh historical token usage.", error);
      })
      .finally(() => {
        pending = false;
        if (again) {
          again = false;
          refresh();
        }
      });
  }
  context.lifecycle.defer(clear);
  return { get: (id: number) => values.get(id), clear, refresh };
}
export type UsageHistory = ReturnType<typeof createHistory>;
