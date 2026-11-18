import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import type { Config, Field } from "../domain/config.ts";
import type { StateGeneration } from "../state/generation.ts";
import type { StateHost } from "../runtime/host.ts";
import { DEFAULT_PROMPT } from "../domain/prompt.ts";
import { DEFAULT_TOOL_DESCRIPTION } from "../domain/tool.ts";
import { errorText } from "../domain/errors.ts";
import { message } from "../../../../../shared/i18n/message.ts";
export function createModel(
  context: ModuleContext,
  host: StateHost,
  generation: StateGeneration,
  getConfig: () => Config,
  isActive: () => boolean,
) {
  const tool = "state_trace_update";
  const prompt = `state-trace-${context.host.scriptId}`;
  const owner = `${context.instanceId}:${context.generation}`;
  const key = Symbol.for("loreloom.state-trace.model-owners");
  const parent = context.host.window as Window & {
    [key: symbol]: Map<string, string> | undefined;
  };
  const owners = parent[key] ?? new Map<string, string>();
  parent[key] = owners;
  let registered = false;
  function fieldSchema(field: Field): Record<string, unknown> {
    const description = `${field.label || field.name}: ${field.description}`;
    if (field.type === "toggle") return { type: "boolean", description };
    if (field.type === "tag")
      return { type: "string", description, enum: field.options };
    if (field.type === "text")
      return {
        type: "string",
        description,
        ...(field.maxLength !== undefined
          ? { maxLength: field.maxLength }
          : {}),
      };
    return {
      type: "number",
      description,
      ...(field.min !== undefined ? { minimum: field.min } : {}),
      ...(field.max !== undefined ? { maximum: field.max } : {}),
    };
  }
  function refreshPrompt(): void {
    if (!isActive() || !host.isCurrent()) return;
    const config = getConfig();
    const current = host.current();
    if (!current.setExtensionPrompt) return;
    const enabled = config.enabled && config.fields.length && current.chatId;
    const template = config.prompt || context.translate(DEFAULT_PROMPT);
    const text = enabled
      ? template.replace(/\{\{(state|toolName)\}\}/g, (_match, key: string) =>
          key === "state"
            ? JSON.stringify(generation.currentValues(config))
            : tool,
        )
      : "";
    owners.set(prompt, owner);
    current.setExtensionPrompt(prompt, text, text ? 1 : -1, 0, false, 0);
  }
  function clear(): void {
    const current = host.current();
    if (owners.get(tool) === owner) {
      try {
        if (registered) current.unregisterFunctionTool?.(tool);
      } finally {
        owners.delete(tool);
      }
    }
    registered = false;
    if (owners.get(prompt) === owner) {
      try {
        current.setExtensionPrompt?.(prompt, "", -1, 0, false, 0);
      } finally {
        owners.delete(prompt);
      }
    }
  }
  function register(): void {
    clear();
    if (!isActive() || !host.isCurrent()) return;
    const config = getConfig();
    if (!config.enabled || !config.fields.length) return;
    const current = host.current();
    if (current.registerFunctionTool && current.unregisterFunctionTool) {
      current.registerFunctionTool({
        name: tool,
        displayName: context.translate(
          message("loreloom.stateTrace.toolTitle", "Update state"),
        ),
        description:
          config.toolDescription?.trim() ||
          context.translate(DEFAULT_TOOL_DESCRIPTION),
        parameters: {
          type: "object",
          properties: Object.fromEntries(
            config.fields.map((field) => [field.name, fieldSchema(field)]),
          ),
          required: [],
          additionalProperties: false,
        },
        shouldRegister: () =>
          isActive() &&
          host.isCurrent() &&
          getConfig().enabled &&
          !!host.current().chatId,
        action: async (updates) => {
          if (!isActive() || !host.isCurrent() || !getConfig().enabled)
            throw new Error("State tracking is not active.");
          try {
            const state = generation.updateRound(getConfig(), updates);
            refreshPrompt();
            return { updatedFields: Object.keys(updates), state };
          } catch (error) {
            throw new Error(errorText(context, error));
          }
        },
      });
      owners.set(tool, owner);
      registered = true;
    } else
      console.warn(
        "Function tool APIs are unavailable; state trace remains editable manually.",
      );
    refreshPrompt();
  }
  context.lifecycle.defer(clear);
  return { register, refreshPrompt, clear };
}
