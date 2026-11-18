import type { ModuleContext } from "../../shared/contracts/module.ts";

export function createOwnership(context: ModuleContext, service: string) {
  context.services.provide(service, () => null);
  const listeners = new Set<() => void>();
  const isActive = () =>
    !context.signal.aborted &&
    context.services.find(service)?.instanceId === context.instanceId;
  let previous = isActive();
  const sync = () => {
    if (context.signal.aborted) return;
    const current = isActive();
    if (current === previous) return;
    previous = current;
    for (const listener of listeners) listener();
  };
  context.services.subscribe(sync);
  context.lifecycle.defer(context.host.subscribe("SETTINGS_UPDATED", sync));
  context.lifecycle.interval(sync, 5000);
  context.lifecycle.defer(() => listeners.clear());
  return {
    isActive,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      const dispose = () => {
        listeners.delete(listener);
      };
      context.lifecycle.defer(dispose);
      return dispose;
    },
  };
}
