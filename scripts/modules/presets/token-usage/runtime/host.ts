import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
export interface UsageMessage {
  mes?: string;
  gen_finished?: unknown;
  is_user?: boolean;
  is_system?: boolean;
  extra?: Record<string, unknown>;
  swipe_id?: number;
  swipes?: string[];
  swipe_info?: (
    { gen_finished?: unknown; extra?: Record<string, unknown> } | undefined
  )[];
}
export interface UsageContext {
  chat: (UsageMessage | undefined)[];
  chatId?: string;
  mainApi: string;
  maxContext: number;
  chatCompletionSettings?: { openai_max_context?: number };
  getTokenCountAsync?: (text: string, padding?: number) => Promise<number>;
  saveChat: () => Promise<void>;
}
interface PromptStorage {
  getItem(key: string): Promise<unknown>;
}
interface HostGlobals {
  SillyTavern?: {
    getContext(): UsageContext;
    libs?: {
      yaml?: { parse(text: string): unknown };
      localforage?: {
        createInstance(options: { name: string }): PromptStorage;
      };
    };
  };
  localforage?: { createInstance(options: { name: string }): PromptStorage };
}
export function createUsageHost(context: ModuleContext) {
  const parent = context.host.window as unknown as HostGlobals;
  const frame = window as unknown as HostGlobals;
  const tavern = parent.SillyTavern ?? frame.SillyTavern;
  if (!tavern) throw new Error("Token usage requires the SillyTavern context.");
  const scope = JSON.stringify(context.scope);
  const current = () => tavern.getContext();
  const isCurrent = () => {
    if (context.signal.aborted) return false;
    try {
      return JSON.stringify(context.host.scope()) === scope;
    } catch {
      return false;
    }
  };
  const localforage = tavern.libs?.localforage ?? parent.localforage;
  let storage: PromptStorage | undefined;
  try {
    storage = localforage?.createInstance({ name: "SillyTavern_Prompts" });
  } catch {
    /* Saved prompts are optional. */
  }
  return {
    current,
    isCurrent,
    async count(text: string): Promise<number | undefined> {
      if (!isCurrent()) return undefined;
      try {
        const host = current();
        const value = await host.getTokenCountAsync?.(text, 0);
        return isCurrent() &&
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= 0
          ? value
          : undefined;
      } catch (error) {
        if (isCurrent()) console.warn("Could not estimate token usage.", error);
        return undefined;
      }
    },
    async prompts(chatId: string): Promise<unknown> {
      return storage?.getItem(chatId);
    },
    parseYaml(text: string): unknown {
      if (tavern.libs?.yaml) return tavern.libs.yaml.parse(text);
      return JSON.parse(text);
    },
  };
}
export type UsageHost = ReturnType<typeof createUsageHost>;
