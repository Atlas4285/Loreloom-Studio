import type { StateHost } from "../runtime/host.ts";
import { reconcile, type Config } from "../domain/config.ts";
import { pendingSwipe, snapshot, type StateStore } from "./store.ts";

export function createHistory(host: StateHost, store: StateStore) {
  function sync(config: Config, before = host.current().chat.length): boolean {
    if (!config.enabled || !config.fields.length || !host.current().chatId)
      return false;
    let changed = store.initialize(config);
    let values = store.readState(config, 0);
    const chat = host.current().chat;
    for (let id = 0; id < Math.min(before, chat.length); id++) {
      const message = chat[id];
      if (!message || pendingSwipe(message)) continue;
      const saved = snapshot(message);
      if (saved) values = reconcile(config, { ...values, ...saved });
      else changed = store.writeSnapshot(id, values) || changed;
    }
    return changed;
  }
  return { sync };
}
export type StateHistory = ReturnType<typeof createHistory>;
