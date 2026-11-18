import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import type { StateHost, StateMessage } from "../runtime/host.ts";

export interface ChatSession {
  chatId: string | undefined;
  chat: (StateMessage | undefined)[];
}
const QUEUES = Symbol.for("loreloom.state-trace.chat-saves");

export function createPersistence(
  context: ModuleContext,
  host: StateHost,
  isActive: () => boolean,
) {
  const page = context.host.window as Window & {
    [QUEUES]?: Map<string, Promise<unknown>>;
  };
  const queues = (page[QUEUES] ??= new Map());
  const keyFor = (target: ChatSession) =>
    JSON.stringify([
      context.scope.characterId,
      context.scope.groupId,
      target.chatId,
    ]);
  let failed = false;
  const listeners = new Set<() => void>();
  const session = (): ChatSession => ({
    chatId: host.current().chatId,
    chat: host.current().chat,
  });
  const sameSession = (expected: ChatSession) =>
    host.isCurrent() &&
    isActive() &&
    host.current().chatId === expected.chatId &&
    host.current().chat === expected.chat;
  const notify = () => {
    if (context.signal.aborted || !host.isCurrent()) return;
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        console.error("State persistence listener failed.", error);
      }
    }
  };
  function persist(
    expected = session(),
    valid: () => boolean = () => true,
    prepare?: () => () => void,
  ): Promise<boolean> {
    const key = keyFor(expected);
    const queue = queues.get(key) ?? Promise.resolve();
    const saving = queue
      .catch(() => {})
      .then(async () => {
        if (!sameSession(expected) || !expected.chatId || !valid())
          return false;
        // Configuration changes are staged only after earlier chat saves finish.
        const rollback = prepare?.();
        try {
          await host.current().saveChat();
          if (!sameSession(expected)) return false;
          failed = false;
          notify();
          return true;
        } catch (error) {
          if (sameSession(expected)) {
            rollback?.();
            failed = true;
            notify();
          }
          throw error;
        }
      });
    queues.set(key, saving);
    const remove = () => {
      if (queues.get(key) === saving) queues.delete(key);
    };
    void saving.then(remove, remove);
    return saving;
  }
  context.lifecycle.defer(() => listeners.clear());
  return {
    session,
    sameSession,
    persist,
    flush: async () => {
      await queues.get(keyFor(session()));
    },
    saveFailed: () => failed,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      const remove = () => listeners.delete(listener);
      return () => {
        remove();
      };
    },
  };
}
export type StatePersistence = ReturnType<typeof createPersistence>;
