import type {
  ModuleContext,
  ModuleSettings,
} from "../../../../../shared/contracts/module.ts";

export class NextActionExecutor {
  private lastSent: string | null = null;
  private resetTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly context: ModuleContext,
    private readonly settings: ModuleSettings,
    private readonly refresh: () => void,
  ) {
    context.lifecycle.defer(() => clearTimeout(this.resetTimer));
  }
  blocked(key: string): boolean {
    return this.lastSent === key;
  }
  reset(): void {
    this.lastSent = null;
    clearTimeout(this.resetTimer);
  }
  execute(action: string, key: string): void {
    this.context.lifecycle.assertActive();
    const behavior = this.settings.read().values.behavior;
    if (
      !this.context.host.fillChatInput(
        action,
        behavior === "append" ? "append" : "replace",
      ) ||
      behavior !== "send"
    )
      return;
    if (!this.context.host.sendChatInput()) return;
    this.lastSent = key;
    this.refresh();
    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => {
      if (this.context.signal.aborted) return;
      if (!this.context.host.isGenerating()) this.lastSent = null;
      this.refresh();
    }, 1500);
  }
}
