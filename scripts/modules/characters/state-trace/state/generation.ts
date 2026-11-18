import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import type { StateHost, StateMessage } from "../runtime/host.ts";
import { pendingSwipe, type StateStore, type Session } from "./store.ts";
import { applyUpdates, type Config, type Values } from "../domain/config.ts";
import { StateError } from "../domain/errors.ts";
import { message } from "../../../../../shared/i18n/message.ts";
interface Point {
  id: number;
  message: StateMessage;
  swipe: number;
}
interface Round extends Session {
  epoch: number;
  values: Values;
  committed: Values;
  target: number;
  base: Point[];
  points: Point[];
  previousMessage?: StateMessage;
  previousText?: string;
  previousFinished?: unknown;
  previousSwipe?: number;
}
function content(message: StateMessage): boolean {
  return (
    !!message.extra?.tool_invocations ||
    (!!message.mes?.trim() && !["...", "…"].includes(message.mes.trim())) ||
    !!message.extra?.reasoning
  );
}
export function createGeneration(
  module: ModuleContext,
  host: StateHost,
  store: StateStore,
  isActive: () => boolean,
) {
  let round: Round | undefined;
  let epoch = 0;
  let saving = 0;
  function point(id: number): Point | undefined {
    const message = host.current().chat[id];
    return message ? { id, message, swipe: message.swipe_id ?? 0 } : undefined;
  }
  function valid(ticket: Round): boolean {
    return (
      ticket.epoch === epoch &&
      isActive() &&
      store.sameSession(ticket) &&
      [...ticket.base, ...ticket.points].every(
        (point) =>
          ticket.chat[point.id] === point.message &&
          (point.message.swipe_id ?? 0) === point.swipe,
      )
    );
  }
  function cancelRound(): void {
    epoch++;
    round = undefined;
  }
  function historyChanged(invalidate = false): void {
    // Empty streaming placeholders are not checkpoints. Removing one must not
    // cancel the tool-call recursion, whereas removing a real checkpoint must.
    if ((round && !valid(round)) || (!round && invalidate)) cancelRound();
  }
  function limit(): number {
    return round && valid(round) ? round.target : host.current().chat.length;
  }
  function generating(): boolean {
    return module.host.isGenerating() || saving > 0;
  }
  function beginRound(
    config: Config,
    type: string | undefined,
    dryRun: boolean,
  ): void {
    if (
      dryRun ||
      type === "quiet" ||
      type === "impersonate" ||
      !config.enabled ||
      !config.fields.length ||
      !host.current().chatId ||
      !isActive() ||
      !host.isCurrent()
    )
      return;
    if (round && valid(round)) return;
    cancelRound();
    const current = store.session();
    const last = current.chat[current.chat.length - 1];
    const replace =
      type === "swipe" || (type === "regenerate" && !last?.is_user);
    const append = type === "continue" || type === "append";
    const target = Math.max(
      0,
      replace || append ? current.chat.length - 1 : current.chat.length,
    );
    const previous = current.chat[target];
    const values = store.readState(
      config,
      replace ? target : current.chat.length,
    );
    const base = current.chat
      .slice(0, target)
      .flatMap((_message, id) => point(id) ?? []);
    round = {
      ...current,
      epoch,
      target,
      base,
      points: [],
      values,
      committed: structuredClone(values),
      previousMessage: previous,
      previousText: previous?.mes,
      previousFinished: previous?.gen_finished,
      previousSwipe: previous?.swipe_id,
    };
  }
  function currentValues(config: Config): Values {
    return round && valid(round)
      ? structuredClone(round.values)
      : store.readState(config);
  }
  function updateRound(config: Config, updates: unknown): Values {
    if (!round || !valid(round))
      throw new StateError(
        message(
          "loreloom.stateTrace.errors.noRound",
          "There is no active generation round to update.",
        ),
      );
    round.values = applyUpdates(config, round.values, updates);
    return structuredClone(round.values);
  }
  function watch(ticket: Round, id: number): void {
    const current = point(id);
    if (!current || ticket.points.some((point) => point.id === id)) return;
    ticket.points.push(current);
  }
  function sent(id: number): void {
    if (round && valid(round)) watch(round, id);
  }
  async function save(ticket: Round): Promise<void> {
    saving++;
    try {
      await store.persist(ticket, () => valid(ticket));
    } finally {
      saving--;
    }
  }
  async function toolsPerformed(invocations: unknown): Promise<void> {
    const ticket = round;
    if (!ticket || !valid(ticket) || !Array.isArray(invocations)) return;
    const id = ticket.chat.findIndex(
      (message, id) =>
        id >= ticket.target &&
        message?.is_system &&
        message.extra?.tool_invocations === invocations,
    );
    if (id < 0) return;
    ticket.committed = structuredClone(ticket.values);
    watch(ticket, id);
    if (store.writeSnapshot(id, ticket.committed)) await save(ticket);
  }
  async function receive(messageId: number): Promise<void> {
    const ticket = round;
    if (
      !ticket ||
      !valid(ticket) ||
      !Number.isSafeInteger(messageId) ||
      messageId < ticket.target
    )
      return;
    const message = ticket.chat[messageId];
    if (
      !message ||
      message.is_user ||
      message.is_system ||
      pendingSwipe(message)
    )
      return;
    if (content(message)) watch(ticket, messageId);
    if (store.writeSnapshot(messageId, ticket.committed)) await save(ticket);
  }
  async function finishRound(): Promise<void> {
    const ending = round;
    round = undefined;
    if (!ending || !valid(ending)) return;
    const id = ending.chat.length - 1;
    const message = ending.chat[id];
    const changed =
      message !== ending.previousMessage ||
      message?.mes !== ending.previousText ||
      message?.gen_finished !== ending.previousFinished ||
      message?.swipe_id !== ending.previousSwipe;
    if (
      id < ending.target ||
      !message ||
      message.is_user ||
      message.is_system ||
      pendingSwipe(message) ||
      !changed ||
      !content(message)
    )
      return;
    watch(ending, id);
    // Unrecorded tool changes are provisional. Only a retained tool message
    // commits them, including when generation fails or is stopped afterwards.
    if (store.writeSnapshot(id, ending.committed)) await save(ending);
  }
  module.lifecycle.defer(cancelRound);
  return {
    generating,
    beginRound,
    currentValues,
    updateRound,
    sent,
    toolsPerformed,
    receive,
    finishRound,
    cancelRound,
    historyChanged,
    limit,
  };
}
export type StateGeneration = ReturnType<typeof createGeneration>;
