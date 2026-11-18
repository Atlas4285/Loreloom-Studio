import { StateError } from "../domain/errors.ts";
import { message } from "../../../../../shared/i18n/message.ts";
import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import type { StateHost, StateMessage } from "../runtime/host.ts";
import {
  applyUpdates,
  reconcile,
  type Config,
  type Values,
} from "../domain/config.ts";
import { ARCHIVE_KEY as KEY, readArchive } from "./archive.ts";
import type { StatePersistence } from "./persistence.ts";
const REVISION = "loreloom_state_trace_revision";
export interface Session {
  chatId: string | undefined;
  chat: (StateMessage | undefined)[];
  index: number;
  message?: StateMessage;
  swipe: number;
}
function valuesOf(value: unknown): Values | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const saved = value as { version?: unknown; values?: unknown };
  if (
    saved.version !== 1 ||
    !saved.values ||
    typeof saved.values !== "object" ||
    Array.isArray(saved.values) ||
    !Object.values(saved.values).every(
      (value) =>
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value)),
    )
  )
    return;
  return saved.values as Values;
}
export function pendingSwipe(message: StateMessage): boolean {
  return (
    !!message.swipes?.length && (message.swipe_id ?? 0) >= message.swipes.length
  );
}
export function snapshot(
  message: StateMessage | undefined,
): Values | undefined {
  if (!message || pendingSwipe(message)) return;
  const extra =
    message.swipes?.length || message.swipe_info?.length
      ? message.swipe_info?.[message.swipe_id ?? 0]?.extra
      : message.extra;
  return valuesOf(extra?.[KEY]);
}
export function createStateStore(
  context: ModuleContext,
  host: StateHost,
  isActive: () => boolean,
  getConfig: () => Config,
  persistence: StatePersistence,
) {
  const { persist, sameSession, saveFailed } = persistence;
  const session = (): Session => {
    const current = host.current();
    const index = current.chat.length - 1;
    const message = current.chat[index];
    return {
      chatId: current.chatId,
      chat: current.chat,
      index,
      message,
      swipe: message?.swipe_id ?? 0,
    };
  };
  function assertCurrent(): void {
    host.assertCurrent();
    if (!isActive())
      throw new StateError(
        message(
          "loreloom.stateTrace.errors.inactive",
          "State trace is not the active instance.",
        ),
      );
  }
  function revision(): number {
    const value = host.current().chatMetadata[REVISION];
    return typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
      ? value
      : 0;
  }
  function changed(): void {
    host.current().chatMetadata[REVISION] = revision() + 1;
  }
  function initialize(config: Config): boolean {
    assertCurrent();
    const metadata = host.current().chatMetadata;
    const previous = valuesOf(metadata[KEY]);
    const values = reconcile(config, previous);
    if (previous && JSON.stringify(previous) === JSON.stringify(values))
      return false;
    metadata[KEY] = { ...readArchive(host), version: 1, values };
    changed();
    return true;
  }
  function readState(
    config: Config,
    before = host.current().chat.length,
  ): Values {
    host.assertCurrent();
    const current = host.current();
    const initial = valuesOf(current.chatMetadata[KEY]);
    for (
      let index = Math.min(before, current.chat.length) - 1;
      index >= 0;
      index--
    ) {
      const saved = snapshot(current.chat[index]);
      if (saved) return reconcile(config, { ...initial, ...saved });
    }
    return reconcile(config, initial);
  }
  function writeSnapshot(id: number, values: Values): boolean {
    assertCurrent();
    const chatMessage = host.current().chat[id];
    if (!chatMessage || pendingSwipe(chatMessage)) return false;
    const saved = { version: 1, values: structuredClone(values) };
    let modified = false;
    const write = (target: { extra?: Record<string, unknown> }) => {
      if (JSON.stringify(target.extra?.[KEY]) === JSON.stringify(saved)) return;
      target.extra ??= {};
      target.extra[KEY] = structuredClone(saved);
      modified = true;
    };
    write(chatMessage);
    if (chatMessage.swipes?.length || chatMessage.swipe_info?.length) {
      chatMessage.swipe_info ??= [];
      const swipe = chatMessage.swipe_id ?? 0;
      chatMessage.swipe_info[swipe] ??= {};
      write(chatMessage.swipe_info[swipe]!);
    }
    if (modified) changed();
    return modified;
  }
  async function editState(
    config: Config,
    updates: unknown,
    expected: Session,
    expectedRevision: number,
  ): Promise<Values> {
    assertCurrent();
    if (!sameSession(expected) || context.host.isGenerating())
      throw new StateError(
        message(
          "loreloom.stateTrace.errors.editContextChanged",
          "State editing context has changed.",
        ),
      );
    const selected = session();
    if (
      revision() !== expectedRevision ||
      selected.index !== expected.index ||
      selected.message !== expected.message ||
      selected.swipe !== expected.swipe ||
      JSON.stringify(getConfig()) !== JSON.stringify(config)
    )
      throw new StateError(
        message(
          "loreloom.stateTrace.errors.stateConflict",
          "State or field configuration changed. Reopen state editing before trying again.",
        ),
      );
    if (!selected.chatId)
      throw new StateError(
        message(
          "loreloom.stateTrace.errors.openChat",
          "Open a chat before editing state.",
        ),
      );
    const values = applyUpdates(config, readState(config), updates);
    if (selected.message && pendingSwipe(selected.message))
      throw new StateError(
        message(
          "loreloom.stateTrace.errors.editContextChanged",
          "State editing context has changed.",
        ),
      );
    if (selected.message) writeSnapshot(selected.index, values);
    else {
      host.current().chatMetadata[KEY] = {
        ...readArchive(host),
        version: 1,
        values,
      };
      changed();
    }
    try {
      const saved = await persist(selected, () => {
        const current = session();
        return (
          current.index === selected.index &&
          current.message === selected.message &&
          current.swipe === selected.swipe
        );
      });
      if (!saved)
        throw new Error("State editing context changed before saving.");
    } catch (error) {
      console.warn("Could not persist edited state.", error);
      throw new StateError(
        message(
          "loreloom.stateTrace.errors.saveFailed",
          "Could not save state to the chat. The displayed changes may not have been persisted.",
        ),
      );
    }
    return values;
  }
  return {
    session,
    sameSession,
    initialize,
    readState,
    writeSnapshot,
    persist,
    editState,
    revision,
    saveFailed,
  };
}
export type StateStore = ReturnType<typeof createStateStore>;
