import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
export interface StateMessage {
  mes?: string;
  gen_finished?: unknown;
  is_user?: boolean;
  is_system?: boolean;
  extra?: Record<string, unknown>;
  swipe_id?: number;
  swipes?: string[];
  swipe_info?: ({ extra?: Record<string, unknown> } | undefined)[];
}
export interface FunctionTool {
  name: string;
  displayName: string;
  description: string;
  parameters: Record<string, unknown>;
  action: (updates: Record<string, unknown>) => Promise<unknown>;
  shouldRegister?: () => boolean;
}
export interface StateContext {
  chatId?: string;
  chat: (StateMessage | undefined)[];
  chatMetadata: Record<string, unknown>;
  saveChat(): Promise<void>;
  saveMetadata(): Promise<void>;
  setExtensionPrompt?(
    key: string,
    text: string,
    position: number,
    depth: number,
    scan: boolean,
    role: number,
  ): void;
  registerFunctionTool?(tool: FunctionTool): void;
  unregisterFunctionTool?(name: string): void;
  isToolCallingSupported?(): boolean;
}
export function createStateHost(context: ModuleContext) {
  const globals = context.host.window as unknown as {
    SillyTavern?: { getContext(): StateContext };
  };
  const tavern =
    globals.SillyTavern ?? (window as unknown as typeof globals).SillyTavern;
  if (!tavern) throw new Error("State trace requires the SillyTavern context.");
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
  return {
    current,
    isCurrent,
    assertCurrent: () => {
      if (!isCurrent()) throw new Error("State trace context has changed.");
    },
  };
}
export type StateHost = ReturnType<typeof createStateHost>;
