import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import { message } from "../../../../../shared/i18n/message.ts";
import { generateIntegers } from "../domain/random.ts";
import { TOOL_NAME, parameters } from "../domain/tool.ts";

interface ToolContext {
  registerFunctionTool?(tool: {
    name: string;
    displayName: string;
    description: string;
    parameters: Record<string, unknown>;
    shouldRegister: () => boolean;
    action: (input: unknown) => Promise<number[]>;
  }): void;
  unregisterFunctionTool?(name: string): void;
}
export function createModel(
  context: ModuleContext,
  isActive: () => boolean,
  description: () => string,
) {
  const globals = context.host.window as unknown as {
    SillyTavern?: { getContext(): ToolContext };
  };
  const scope = JSON.stringify(context.scope);
  const owner = `${context.instanceId}:${context.generation}`;
  const key = Symbol.for("loreloom.random-integer.model-owners");
  const parent = context.host.window as Window & {
    [key: symbol]: Map<string, string> | undefined;
  };
  const owners = parent[key] ?? new Map<string, string>();
  parent[key] = owners;
  let registered: ToolContext | undefined;
  const available = () => {
    if (!isActive() || context.signal.aborted) return false;
    try {
      const current = context.host.scope();
      return (
        current.target === "character" &&
        !!current.characterId &&
        !!current.chatId &&
        !current.groupId &&
        JSON.stringify(current) === scope
      );
    } catch {
      return false;
    }
  };
  function clear() {
    if (owners.get(TOOL_NAME) === owner) {
      try {
        registered?.unregisterFunctionTool?.(TOOL_NAME);
      } finally {
        owners.delete(TOOL_NAME);
      }
    }
    registered = undefined;
  }
  function register() {
    clear();
    if (!available()) return;
    const host = globals.SillyTavern?.getContext();
    if (!host?.registerFunctionTool || !host.unregisterFunctionTool) {
      console.warn("Random integer function tool APIs are unavailable.");
      return;
    }
    host.registerFunctionTool({
      name: TOOL_NAME,
      displayName: context.translate(
        message("loreloom.randomInteger.toolTitle", "Generate random integers"),
      ),
      description: description(),
      parameters,
      shouldRegister: available,
      action: async (input) => {
        if (!available() || owners.get(TOOL_NAME) !== owner)
          throw new Error(
            context.translate(
              message(
                "loreloom.randomInteger.errors.inactive",
                "Random integer generation is not active in this chat.",
              ),
            ),
          );
        return generateIntegers(input, context.host.window.crypto, (source) =>
          context.translate(source),
        );
      },
    });
    owners.set(TOOL_NAME, owner);
    registered = host;
  }
  context.lifecycle.defer(clear);
  return { register, clear };
}
