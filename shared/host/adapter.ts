import type { JsonValue } from "../contracts/services.ts";
export type CarrierTarget = "preset" | "character";
export interface HostScope {
  target: CarrierTarget;
  scriptId: string;
  characterId: string | null;
  chatId: string | null;
  groupId: string | null;
}
export interface ChatMessage {
  mes?: string;
  name?: string;
  is_user?: boolean;
  is_system?: boolean;
}
interface HostContext {
  chat: (ChatMessage | undefined)[];
  messageFormatting?: (
    text: string,
    name: string | undefined,
    isSystem: boolean | undefined,
    isUser: boolean | undefined,
    messageId: number,
    extra: Record<string, never>,
    isRaw: boolean,
  ) => string;
  characterId?: string | number;
  groupId?: string | number;
  chatId?: string;
  characters?: { avatar?: string }[];
  getCurrentLocale?: () => string;
  eventTypes: Record<string, string>;
  eventSource: {
    on: (event: string, callback: (...args: unknown[]) => void) => void;
    removeListener: (
      event: string,
      callback: (...args: unknown[]) => void,
    ) => void;
  };
}
interface ScriptTree {
  type: "script" | "folder";
  id: string;
  enabled: boolean;
  scripts?: ScriptTree[];
}
interface ScriptGlobals {
  getScriptTrees?: (options: {
    type: "global" | CarrierTarget;
  }) => ScriptTree[];
  SillyTavern?: { getContext: () => HostContext };
  getScriptId?: () => string;
  getVariables?: (options: {
    type: "script";
    script_id: string;
  }) => Record<string, unknown>;
  replaceVariables?: (
    variables: Record<string, unknown>,
    options: { type: "script"; script_id: string },
  ) => void;
}
export interface HostAdapter {
  readonly document: Document;
  readonly window: Window;
  readonly scriptId: string;
  scope(): HostScope;
  scriptOrder(): readonly string[];
  locale(): string;
  messages(): readonly (ChatMessage | undefined)[];
  formatMessage(text: string, messageId: number): string;
  isGenerating(): boolean;
  fillChatInput(text: string, mode?: "replace" | "append"): boolean;
  sendChatInput(): boolean;
  read(key: string): unknown;
  write(key: string, value: JsonValue): void;
  subscribe(event: string, callback: (...args: unknown[]) => void): () => void;
  listenMessages(callback: (text: string) => void): () => void;
  sendMessage(text: string): void;
}
const busEvent = "loreloom:services:1";
export function createHostAdapter(target: CarrierTarget): HostAdapter {
  const globals = window as unknown as ScriptGlobals;
  let hostWindow: Window = window;
  try {
    if ((window.parent as unknown as ScriptGlobals).SillyTavern?.getContext)
      hostWindow = window.parent;
  } catch {
    /* Same-origin host access is required. */
  }
  const hostGlobals = hostWindow as unknown as ScriptGlobals;
  const tavern = globals.SillyTavern ?? hostGlobals.SillyTavern;
  if (
    !tavern ||
    !globals.getScriptId ||
    !globals.getVariables ||
    !globals.replaceVariables
  )
    throw new Error("Required Tavern Helper APIs are unavailable.");
  const getVariables = globals.getVariables;
  const replaceVariables = globals.replaceVariables;
  const scriptId = globals.getScriptId();
  if (!scriptId) throw new Error("Script identity is unavailable.");
  const option = { type: "script" as const, script_id: scriptId };
  function scope(): HostScope {
    // Carrier targets describe build ownership, not the helper installation list.
    // The helper controls script enablement and unloads its execution frame.
    const context = tavern!.getContext();
    const groupId = context.groupId == null ? null : String(context.groupId);
    const character =
      !groupId && context.characterId != null
        ? context.characters?.[Number(context.characterId)]?.avatar
        : undefined;
    if (target === "character" && !character)
      throw new Error("A single active character is required.");
    return {
      target,
      scriptId,
      characterId: character ?? null,
      chatId: context.chatId ?? null,
      groupId,
    };
  }
  const isGenerating = () => {
    const stop = hostWindow.document.querySelector<HTMLElement>("#mes_stop");
    return (
      hostWindow.document.body?.dataset.generating === "true" ||
      (!!stop &&
        !stop.hidden &&
        hostWindow.getComputedStyle(stop).display !== "none" &&
        hostWindow.getComputedStyle(stop).visibility !== "hidden")
    );
  };
  const adapter: HostAdapter = {
    document: hostWindow.document,
    window: hostWindow,
    scriptId,
    scope,
    scriptOrder: () => {
      if (!globals.getScriptTrees) return [];
      const ids: string[] = [];
      const collect = (entries: ScriptTree[]) => {
        for (const entry of entries) {
          if (!entry.enabled) continue;
          if (entry.type === "folder") collect(entry.scripts ?? []);
          else ids.push(entry.id);
        }
      };
      for (const type of ["global", "preset", "character"] as const) {
        try {
          collect(globals.getScriptTrees({ type }));
        } catch {
          /* An unavailable carrier must not hide other script lists. */
        }
      }
      return ids;
    },
    locale: () => tavern.getContext().getCurrentLocale?.() ?? "en",
    messages: () =>
      tavern.getContext().chat.map((item) => (item ? { ...item } : undefined)),
    formatMessage: (text, messageId) => {
      const context = tavern.getContext();
      const item = context.chat[messageId];
      if (!item || !context.messageFormatting)
        throw new Error("Host message formatting is unavailable.");
      return context.messageFormatting(
        text,
        item.name,
        item.is_system,
        item.is_user,
        messageId,
        {},
        false,
      );
    },
    isGenerating,
    fillChatInput: (text, mode = "replace") => {
      const input =
        hostWindow.document.querySelector<HTMLTextAreaElement>(
          "#send_textarea",
        );
      if (!input || input.disabled || input.readOnly || isGenerating())
        return false;
      input.value =
        mode === "append"
          ? input.value +
            (input.value && !input.value.endsWith("\n") ? "\n" : "") +
            text
          : text;
      const HostEvent = (hostWindow as Window & typeof globalThis).Event;
      input.dispatchEvent(new HostEvent("input", { bubbles: true }));
      input.focus();
      return true;
    },
    sendChatInput: () => {
      const button =
        hostWindow.document.querySelector<HTMLElement>("#send_but");
      if (
        !button ||
        isGenerating() ||
        button.hasAttribute("disabled") ||
        button.getAttribute("aria-disabled") === "true" ||
        hostWindow.getComputedStyle(button).display === "none"
      )
        return false;
      button.click();
      return true;
    },
    read: (key) => structuredClone(getVariables(option)[key]),
    write: (key, value) => {
      scope();
      const variables = structuredClone(getVariables(option));
      variables[key] = structuredClone(value);
      replaceVariables(variables, option);
    },
    subscribe: (event, callback) => {
      const context = tavern.getContext();
      const name = context.eventTypes[event];
      if (
        !name ||
        !context.eventSource?.on ||
        !context.eventSource.removeListener
      )
        throw new Error(`Required host event is unavailable: ${event}`);
      context.eventSource.on(name, callback);
      return () => context.eventSource.removeListener(name, callback);
    },
    listenMessages: (callback) => {
      const listener = (event: Event) => {
        const detail: unknown = (event as CustomEvent<unknown>).detail;
        if (typeof detail === "string") callback(detail);
      };
      hostWindow.addEventListener(busEvent, listener);
      return () => hostWindow.removeEventListener(busEvent, listener);
    },
    sendMessage: (text) => {
      hostWindow.dispatchEvent(new CustomEvent(busEvent, { detail: text }));
    },
  };
  scope();
  return adapter;
}
