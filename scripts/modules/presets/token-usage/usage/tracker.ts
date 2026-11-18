import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import type { UsageHost, UsageMessage } from "../runtime/host.ts";
import type { GenerationResponse } from "../api/response.ts";
import {
  API_USAGE_KEY,
  USAGE_KEY,
  REFERENCE_KEY,
  contextLimit,
  hasRequestUsage,
  isToolMessage,
  messageUsageExtra,
  promptText,
  readRequests,
  readStoredUsage,
  record,
  type RequestUsage,
} from "../domain/usage.ts";
const ANCHOR_KEY = "loreloom_token_usage_anchor";
const QUEUES = Symbol.for("loreloom.token-usage.saves");
interface Anchor {
  message: UsageMessage;
  swipe: number;
  key: string;
  swiped: boolean;
}
interface Ticket {
  requestId: string;
  chainId: string;
  sequence: number;
  startedAt: number;
  chat: (UsageMessage | undefined)[];
  chatId: string;
  expected: number;
  type?: string;
  limit?: number;
  prompt: string;
  lastUser?: UsageMessage;
  before?: UsageMessage;
  beforeText?: string;
  beforeReasoning?: string;
  beforeFinished?: unknown;
  beforeSwipe: number;
  candidate?: Anchor;
  target?: Anchor;
  candidateText?: string;
  candidateReasoning?: string;
  kind: "assistant" | "tool_call";
  toolCalls: GenerationResponse["toolCalls"];
  response?: GenerationResponse;
  ready: boolean;
  uiEnded: boolean;
  processing: boolean;
  written: boolean;
}
export function createTracker(
  context: ModuleContext,
  host: UsageHost,
  isActive: () => boolean,
  onSaved: (id: number) => void,
) {
  let active: Ticket | undefined;
  let intent: { type?: string; prompt: string } = { prompt: "" };
  let lastTool: Ticket | undefined;
  let counter = 0,
    stamp = 0;
  const tickets = new Set<Ticket>();
  const jobs = new Set<Promise<void>>();
  const page = context.host.window as Window & {
    [QUEUES]?: Map<string, Promise<unknown>>;
  };
  const queues = (page[QUEUES] ??= new Map());
  const uid = () =>
    context.host.window.crypto?.randomUUID?.() ??
    `${context.instanceId}-${Date.now()}-${++counter}`;
  const valid = (ticket: Ticket) =>
    isActive() &&
    host.isCurrent() &&
    tickets.has(ticket) &&
    host.current().chat === ticket.chat &&
    host.current().chatId === ticket.chatId;
  function extras(anchor: Anchor): Record<string, unknown> | undefined {
    return anchor.swiped
      ? anchor.message.swipe_info?.[anchor.swipe]?.extra
      : anchor.message.extra;
  }
  function anchorValid(ticket: Ticket, anchor: Anchor): boolean {
    return (
      valid(ticket) &&
      ticket.chat.includes(anchor.message) &&
      extras(anchor)?.[ANCHOR_KEY] === anchor.key
    );
  }
  function anchorFor(ticket: Ticket, message: UsageMessage): Anchor {
    const swipe = message.swipe_id ?? 0;
    const swiped = !!(message.swipes?.length || message.swipe_info?.length);
    message.extra ??= {};
    let extra = message.extra;
    if (swiped) {
      message.swipe_info ??= [];
      message.swipe_info[swipe] ??= {};
      extra = message.swipe_info[swipe]!.extra ??= {};
    }
    let key =
      typeof extra[ANCHOR_KEY] === "string"
        ? (extra[ANCHOR_KEY] as string)
        : undefined;
    if (
      message.swipe_info?.some(
        (item, index) => index !== swipe && item?.extra?.[ANCHOR_KEY] === key,
      )
    )
      key = undefined;
    if (!key || ticket.type === "swipe") key = uid();
    extra[ANCHOR_KEY] = message.extra[ANCHOR_KEY] = key;
    if (ticket.type === "swipe") {
      extra[USAGE_KEY] = message.extra[USAGE_KEY] = {
        version: 1,
        requests: [],
      };
      delete extra[API_USAGE_KEY];
      delete message.extra[API_USAGE_KEY];
      delete extra[REFERENCE_KEY];
      delete message.extra[REFERENCE_KEY];
    }
    return { message, swipe, key, swiped };
  }
  function updateAnchor(
    anchor: Anchor,
    update: (extra: Record<string, unknown>) => void,
  ): void {
    const extra = extras(anchor);
    if (!extra) return;
    update(extra);
    if (anchor.swiped && (anchor.message.swipe_id ?? 0) === anchor.swipe) {
      anchor.message.extra ??= {};
      for (const key of [USAGE_KEY, API_USAGE_KEY, REFERENCE_KEY, ANCHOR_KEY]) {
        if (extra[key] === undefined) delete anchor.message.extra[key];
        else anchor.message.extra[key] = structuredClone(extra[key]);
      }
    }
  }
  function descriptor(ticket: Ticket): RequestUsage {
    return {
      requestId: ticket.requestId,
      chainId: ticket.chainId,
      sequence: ticket.sequence,
      startedAt: ticket.startedAt,
      kind: ticket.kind,
      toolCallIds: ticket.toolCalls.flatMap((call) =>
        call.id ? [call.id] : [],
      ),
      limit: ticket.limit,
      status: "pending",
      estimated: true,
    };
  }
  function write(ticket: Ticket, entry: RequestUsage): void {
    if (!ticket.target || !anchorValid(ticket, ticket.target)) return;
    const anchor = ticket.target;
    updateAnchor(anchor, (extra) => {
      const requests = readRequests(extra);
      if (!hasRequestUsage(extra)) {
        const legacy = readStoredUsage(extra, ticket.limit);
        if (
          legacy &&
          ticket.before === anchor.message &&
          ["continue", "append"].includes(ticket.type ?? "")
        )
          requests.push({
            ...legacy,
            requestId: `legacy-${anchor.key}`,
            chainId: `legacy-${anchor.key}`,
            sequence: 1,
            startedAt: 0,
            kind: "assistant",
            toolCallIds: [],
            status: "completed",
          });
      }
      const index = requests.findIndex(
        (item) => item.requestId === entry.requestId,
      );
      if (index < 0) requests.push(entry);
      else requests[index] = entry;
      requests.sort(
        (a, b) => a.startedAt - b.startedAt || a.sequence - b.sequence,
      );
      extra[USAGE_KEY] = { version: 1, requests: structuredClone(requests) };
      delete extra[API_USAGE_KEY];
    });
  }
  function persist(ticket: Ticket): Promise<void> {
    const key = JSON.stringify([
      context.scope.characterId,
      context.scope.groupId,
      ticket.chatId,
    ]);
    const next = (queues.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!ticket.target || !anchorValid(ticket, ticket.target)) return;
        await host.current().saveChat();
      });
    queues.set(key, next);
    const remove = () => {
      if (queues.get(key) === next) queues.delete(key);
    };
    void next.then(remove, remove);
    return next;
  }
  function notify(ticket: Ticket): void {
    if (valid(ticket) && ticket.target)
      onSaved(ticket.chat.indexOf(ticket.target.message));
  }
  function suppressCandidate(ticket: Ticket): void {
    if (
      !ticket.candidate ||
      ticket.candidate.message === ticket.target?.message ||
      !anchorValid(ticket, ticket.candidate)
    )
      return;
    updateAnchor(ticket.candidate, (extra) => {
      const requests = readRequests(extra).filter(
        (item) => item.requestId !== ticket.requestId,
      );
      extra[USAGE_KEY] = { version: 1, requests };
      delete extra[API_USAGE_KEY];
      extra[REFERENCE_KEY] = { version: 1, requestId: ticket.requestId };
    });
  }
  async function settle(ticket: Ticket): Promise<void> {
    if (!valid(ticket) || !ticket.ready || ticket.processing || ticket.written)
      return;
    const response = ticket.response;
    if (!response?.kind && ticket.kind !== "tool_call" && !ticket.uiEnded)
      return;
    if (!ticket.target) {
      if (
        ticket.kind === "tool_call" ||
        !ticket.candidate ||
        !anchorValid(ticket, ticket.candidate)
      )
        return;
      ticket.target = ticket.candidate;
    }
    if (!anchorValid(ticket, ticket.target)) return;
    ticket.processing = true;
    const targetAtStart = ticket.target;
    try {
      const api = response?.usage;
      let input = api?.input,
        output = api?.output;
      if (response?.complete) {
        if (input === undefined && ticket.prompt)
          input = await host.count(ticket.prompt);
        if (output === undefined) {
          let text: string | undefined;
          if (response.outputCaptured)
            text =
              response.reasoning +
              response.text +
              (response.toolCalls.length
                ? response.toolCalls
                : ticket.toolCalls
              )
                .map((call) => `${call.name}\n${call.arguments}`)
                .join("\n");
          else if (ticket.kind === "tool_call")
            text = `${ticket.candidateReasoning ?? ""}${ticket.candidateText ?? ""}\n${ticket.toolCalls.map((call) => `${call.name}\n${call.arguments}`).join("\n")}`;
          else if (ticket.candidateText !== undefined)
            text = `${ticket.candidateReasoning ?? ""}${ticket.candidateText}`;
          if (text !== undefined) output = await host.count(text);
        }
      }
      if (
        ticket.target !== targetAtStart ||
        !anchorValid(ticket, ticket.target)
      )
        return;
      const entry: RequestUsage = {
        ...descriptor(ticket),
        input,
        output,
        total_tokens:
          api?.total ??
          (input !== undefined && output !== undefined
            ? input + output
            : undefined),
        inputSource: api?.input === undefined ? "tokenizer" : "api",
        outputSource: api?.output === undefined ? "tokenizer" : "api",
        totalSource: api?.total === undefined ? "tokenizer" : "api",
        estimated:
          api?.input === undefined ||
          api.output === undefined ||
          api.total === undefined,
        status: response?.complete ? "completed" : "stopped",
      };
      write(ticket, entry);
      await persist(ticket);
      if (ticket.target === targetAtStart) ticket.written = true;
    } catch (error) {
      if (valid(ticket))
        console.warn("Could not save request token usage.", error);
    } finally {
      ticket.processing = false;
      notify(ticket);
      if (valid(ticket) && ticket.target !== targetAtStart) finalize(ticket);
    }
  }
  function finalize(ticket: Ticket): void {
    const job = settle(ticket);
    jobs.add(job);
    void job.finally(() => jobs.delete(job));
  }
  function start(type: string | undefined, dryRun: boolean): void {
    if (dryRun || !isActive() || !host.isCurrent()) return;
    intent = { type, prompt: "" };
    if (type === "quiet" || type === "impersonate") return;
    historyChanged();
  }
  function capturePrompt(data: unknown, dryRun: boolean): void {
    if (dryRun || !isActive() || !host.isCurrent()) return;
    const value = record(data);
    if (value)
      intent.prompt = promptText(value.prompt ?? value.input ?? value.messages);
  }
  function captureRequest(
    body: Record<string, unknown>,
    response: Promise<GenerationResponse | undefined>,
  ): void {
    const current = host.current();
    const type = typeof body.type === "string" ? body.type : intent.type;
    if (
      !isActive() ||
      !host.isCurrent() ||
      !current.chatId ||
      type === "quiet" ||
      type === "impersonate"
    )
      return;
    const expected = ["swipe", "continue", "append"].includes(type ?? "")
      ? current.chat.length - 1
      : current.chat.length;
    if (expected < 0) return;
    const before = current.chat[expected];
    const lastUser = [...current.chat]
      .reverse()
      .find((message) => message?.is_user);
    const parent =
      lastTool &&
      valid(lastTool) &&
      lastTool.target?.message === current.chat.at(-1) &&
      lastTool.lastUser === lastUser
        ? lastTool
        : undefined;
    const requestId = uid();
    stamp = Math.max(Date.now(), stamp + 1);
    for (const message of current.chat)
      for (const entry of readRequests(messageUsageExtra(message)))
        stamp = Math.max(stamp, entry.startedAt + 1);
    const metadata = Object.fromEntries(
      ["tools", "functions", "response_format"]
        .filter((key) => body[key] !== undefined)
        .map((key) => [key, body[key]]),
    );
    const prompt =
      promptText(body.messages ?? body.prompt ?? body.input) || intent.prompt;
    const ticket: Ticket = {
      requestId,
      chainId: parent?.chainId ?? requestId,
      sequence: parent ? parent.sequence + 1 : 1,
      startedAt: stamp,
      chat: current.chat,
      chatId: current.chatId,
      expected,
      type,
      limit: contextLimit(current),
      prompt:
        prompt +
        (Object.keys(metadata).length ? `\n${JSON.stringify(metadata)}` : ""),
      lastUser,
      before,
      beforeText: before?.mes,
      beforeFinished: before?.gen_finished,
      beforeSwipe: before?.swipe_id ?? 0,
      beforeReasoning:
        typeof before?.extra?.reasoning === "string"
          ? before.extra.reasoning
          : undefined,
      kind: "assistant",
      toolCalls: [],
      ready: false,
      uiEnded: false,
      processing: false,
      written: false,
    };
    active = ticket;
    tickets.add(ticket);
    for (const previous of tickets)
      if (previous !== ticket && previous !== parent && previous.written)
        tickets.delete(previous);
    void response
      .then((value) => {
        if (!valid(ticket)) return;
        ticket.response = value;
        ticket.ready = true;
        if (value?.kind === "tool_call" || value?.toolCalls.length)
          ticket.kind = "tool_call";
        if (value?.toolCalls.length) ticket.toolCalls = value.toolCalls;
        if (ticket.kind === "tool_call") suppressCandidate(ticket);
        finalize(ticket);
      })
      .catch((error) => {
        if (!valid(ticket)) return;
        console.warn("Could not capture request token usage.", error);
        ticket.ready = true;
        finalize(ticket);
      });
  }
  function bindCandidate(ticket: Ticket, id: number): void {
    if (!valid(ticket) || ticket.expected !== id) return;
    const message = ticket.chat[id];
    if (
      !message ||
      message.is_user ||
      message.is_system ||
      (message.swipes?.length &&
        (message.swipe_id ?? 0) >= message.swipes.length)
    )
      return;
    if (
      ticket.type === "swipe" &&
      (message.swipe_id ?? 0) !== ticket.beforeSwipe
    )
      return;
    const changed =
      message !== ticket.before ||
      message.mes !== ticket.beforeText ||
      message.gen_finished !== ticket.beforeFinished ||
      message.swipe_id !== ticket.beforeSwipe;
    if (!changed) return;
    if (
      !ticket.candidate ||
      ticket.candidate.message !== message ||
      ticket.candidate.swipe !== (message.swipe_id ?? 0)
    )
      ticket.candidate = anchorFor(ticket, message);
    const continuation =
      message === ticket.before &&
      ["continue", "append"].includes(ticket.type ?? "");
    const text = message.mes ?? "";
    ticket.candidateText = continuation
      ? text.startsWith(ticket.beforeText ?? "")
        ? text.slice(ticket.beforeText?.length ?? 0)
        : undefined
      : text;
    const reasoning =
      typeof message.extra?.reasoning === "string"
        ? message.extra.reasoning
        : "";
    ticket.candidateReasoning = continuation
      ? reasoning.startsWith(ticket.beforeReasoning ?? "")
        ? reasoning.slice(ticket.beforeReasoning?.length ?? 0)
        : ""
      : reasoning;
  }
  function received(id: number, type?: unknown): void {
    if (
      !Number.isSafeInteger(id) ||
      id < 0 ||
      type === "first_message" ||
      !active
    )
      return;
    bindCandidate(active, id);
    finalize(active);
  }
  function toolsPerformed(invocations: unknown): void {
    if (
      !Array.isArray(invocations) ||
      !invocations.length ||
      !host.isCurrent() ||
      !isActive()
    )
      return;
    const calls = invocations.flatMap((item) => {
      const entry = record(item);
      return entry
        ? [
            {
              id: typeof entry.id === "string" ? entry.id : undefined,
              name: String(entry.name ?? ""),
              arguments:
                typeof entry.parameters === "string"
                  ? entry.parameters
                  : JSON.stringify(entry.parameters ?? {}),
            },
          ]
        : [];
    });
    const ids = calls.flatMap((call) => (call.id ? [call.id] : []));
    const message = [...host.current().chat].reverse().find((item) => {
      if (!isToolMessage(item ?? {})) return false;
      const saved = item?.extra?.tool_invocations;
      return (
        saved === invocations ||
        (ids.length > 0 &&
          Array.isArray(saved) &&
          ids.every((id) => saved.some((value) => record(value)?.id === id)))
      );
    });
    if (!message) return;
    const matching = [...tickets].filter(
      (ticket) =>
        valid(ticket) &&
        ticket.toolCalls.some((call) => call.id && ids.includes(call.id)),
    );
    const ticket =
      matching.at(-1) ??
      (active &&
      valid(active) &&
      (!active.written ||
        (active.target === active.candidate && !active.uiEnded))
        ? active
        : undefined);
    if (!ticket || (ticket.target && ticket.target.message === message)) return;
    if (ticket.target && ticket.target !== ticket.candidate) return;
    ticket.kind = "tool_call";
    ticket.toolCalls = calls;
    ticket.written = false;
    ticket.target = anchorFor(ticket, message);
    if (!ticket.candidateReasoning) {
      const reasoning = record(invocations[0])?.reasoning;
      if (typeof reasoning === "string") ticket.candidateReasoning = reasoning;
    }
    suppressCandidate(ticket);
    write(ticket, descriptor(ticket));
    lastTool = ticket;
    void persist(ticket).catch((error) =>
      console.warn("Could not save pending tool usage.", error),
    );
    notify(ticket);
    finalize(ticket);
  }
  function end(): void {
    for (const ticket of tickets) {
      if (!valid(ticket) || ticket.written) continue;
      ticket.uiEnded = true;
      if (ticket === active && !ticket.candidate && ticket.kind !== "tool_call")
        bindCandidate(ticket, ticket.expected);
      finalize(ticket);
    }
  }
  function historyChanged(): void {
    for (const ticket of tickets)
      if (
        !valid(ticket) ||
        (ticket.target && !anchorValid(ticket, ticket.target))
      )
        tickets.delete(ticket);
  }
  function cancel(): void {
    active = lastTool = undefined;
    tickets.clear();
  }
  function isGenerating(id: number): boolean {
    const message = host.current().chat[id];
    if (
      message?.swipes?.length &&
      (message.swipe_id ?? 0) >= message.swipes.length
    )
      return true;
    return [...tickets].some(
      (ticket) =>
        valid(ticket) &&
        !ticket.written &&
        (ticket.target?.message === message ||
          ticket.candidate?.message === message ||
          (!ticket.target && ticket.expected === id)),
    );
  }
  function ignoresStored(id: number): boolean {
    return isGenerating(id);
  }
  context.lifecycle.defer(cancel);
  return {
    start,
    capturePrompt,
    captureRequest,
    received,
    toolsPerformed,
    end,
    cancel,
    historyChanged,
    isGenerating,
    ignoresStored,
    flush: async () => {
      while (jobs.size) await Promise.all([...jobs]);
      await queues.get(
        JSON.stringify([
          context.scope.characterId,
          context.scope.groupId,
          host.current().chatId,
        ]),
      );
    },
  };
}
export type UsageTracker = ReturnType<typeof createTracker>;
