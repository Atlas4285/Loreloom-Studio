import type { UsageContext, UsageMessage } from "../runtime/host.ts";
export const USAGE_KEY = "loreloom_token_usage";
export const API_USAGE_KEY = "loreloom_token_usage_api";
export interface TokenUsage {
  input?: number;
  output?: number;
  limit?: number;
  estimated: boolean;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  inputSource?: "api" | "tokenizer";
  outputSource?: "api" | "tokenizer";
  totalSource?: "api" | "tokenizer";
}

export interface RequestUsage extends TokenUsage {
  requestId: string;
  chainId: string;
  sequence: number;
  startedAt: number;
  kind: "assistant" | "tool_call";
  toolCallIds: string[];
  status: "pending" | "completed" | "stopped";
}
export const REFERENCE_KEY = `${USAGE_KEY}_reference`;
export function isToolMessage(message: UsageMessage): boolean {
  return Array.isArray(message.extra?.tool_invocations);
}
export function hasRequestUsage(extra: unknown): boolean {
  const data = record(record(extra)?.[USAGE_KEY]);
  return data?.version === 1 && Array.isArray(data.requests);
}
export function isUsageReference(extra: unknown): boolean {
  const data = record(record(extra)?.[REFERENCE_KEY]);
  return data?.version === 1 && typeof data.requestId === "string";
}
export function readRequests(
  extra: unknown,
  fallbackLimit?: number,
): RequestUsage[] {
  const data = record(record(extra)?.[USAGE_KEY]);
  if (data?.version !== 1 || !Array.isArray(data.requests)) return [];
  return data.requests.flatMap((item) => {
    const entry = record(item);
    if (
      !entry ||
      typeof entry.requestId !== "string" ||
      typeof entry.chainId !== "string" ||
      !Number.isSafeInteger(entry.sequence) ||
      Number(entry.sequence) < 1 ||
      typeof entry.startedAt !== "number" ||
      !Number.isFinite(entry.startedAt) ||
      !["assistant", "tool_call"].includes(String(entry.kind)) ||
      !["pending", "completed", "stopped"].includes(String(entry.status)) ||
      !Array.isArray(entry.toolCallIds) ||
      !entry.toolCallIds.every((id) => typeof id === "string")
    )
      return [];
    const input = tokenNumber(entry.input),
      output = tokenNumber(entry.output);
    const inputSource = entry.inputSource === "api" ? "api" : "tokenizer";
    const outputSource = entry.outputSource === "api" ? "api" : "tokenizer";
    const totalSource = entry.totalSource === "api" ? "api" : "tokenizer";
    return [
      {
        requestId: entry.requestId,
        chainId: entry.chainId,
        sequence: Number(entry.sequence),
        startedAt: entry.startedAt,
        kind: entry.kind as RequestUsage["kind"],
        status: entry.status as RequestUsage["status"],
        toolCallIds: entry.toolCallIds as string[],
        input,
        output,
        limit: tokenNumber(entry.limit) ?? fallbackLimit,
        total_tokens: tokenNumber(entry.total_tokens),
        inputSource,
        outputSource,
        totalSource,
        estimated:
          input === undefined ||
          output === undefined ||
          inputSource !== "api" ||
          outputSource !== "api" ||
          totalSource !== "api",
      },
    ];
  });
}
export interface ApiUsage {
  input?: number;
  output?: number;
  total?: number;
}

export function tokenNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function readStoredUsage(
  extra: unknown,
  fallbackLimit?: number,
): TokenUsage | undefined {
  if (hasRequestUsage(extra))
    return readRequests(extra, fallbackLimit)
      .filter((item) => item.status !== "pending")
      .at(-1);
  if (isUsageReference(extra)) return undefined;
  const data = record(record(extra)?.[USAGE_KEY]);
  const api = readRecordedApiUsage(extra);
  const limit = fallbackLimit ?? tokenNumber(data?.limit);
  if (
    api?.input !== undefined &&
    api.output !== undefined &&
    api.total !== undefined &&
    limit
  ) {
    return {
      input: api.input,
      output: api.output,
      limit,
      estimated: false,
      total_tokens: api.total,
      inputSource: "api",
      outputSource: "api",
      totalSource: "api",
    };
  }
  const input = tokenNumber(data?.input);
  const output = tokenNumber(data?.output);
  if (input === undefined || output === undefined || !limit) return undefined;
  if (
    data?.estimated === true &&
    ((data.inputSource !== "api" && data.inputSource !== "tokenizer") ||
      (data.outputSource !== "api" && data.outputSource !== "tokenizer"))
  )
    return undefined;
  const total = tokenNumber(data?.total_tokens) ?? input + output;
  return {
    input,
    output,
    limit,
    estimated: data?.estimated === true,
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: total,
    inputSource: data?.inputSource === "api" ? "api" : "tokenizer",
    outputSource: data?.outputSource === "api" ? "api" : "tokenizer",
    totalSource:
      data?.totalSource === "api" || data?.estimated === false
        ? "api"
        : "tokenizer",
  };
}

export function messageUsageExtra(message: UsageMessage | undefined): unknown {
  if (!message) return undefined;
  const id = message.swipe_id ?? 0;
  if (message.swipes?.length || message.swipe_info?.length)
    return message.swipe_info?.[id]?.extra;
  return message.extra;
}

export function hasGenerationMetadata(message: UsageMessage): boolean {
  const swipe = message.swipe_info?.[message.swipe_id ?? 0];
  // A selected greeting must not inherit another swipe's generation timestamp.
  return !!(swipe ?? message).gen_finished;
}

export function readApiUsage(value: unknown): ApiUsage | undefined {
  const data = record(value);
  const usage = record(
    data?.usage ?? record(data?.message)?.usage ?? record(data?.data)?.usage,
  );
  if (!usage) return undefined;
  const input = tokenNumber(usage.prompt_tokens ?? usage.input_tokens);
  const output = tokenNumber(usage.completion_tokens ?? usage.output_tokens);
  const total = tokenNumber(usage.total_tokens);
  return input === undefined && output === undefined && total === undefined
    ? undefined
    : { input, output, total };
}

export function readRecordedApiUsage(extra: unknown): ApiUsage | undefined {
  const data = record(record(extra)?.[API_USAGE_KEY]);
  if (!data) return undefined;
  const input = tokenNumber(data.prompt_tokens ?? data.input);
  const output = tokenNumber(data.completion_tokens ?? data.output);
  const total = tokenNumber(data.total_tokens ?? data.total);
  return input === undefined && output === undefined && total === undefined
    ? undefined
    : { input, output, total };
}

export function contextLimit(context: UsageContext): number | undefined {
  const raw =
    context.mainApi === "openai"
      ? context.chatCompletionSettings?.openai_max_context
      : context.maxContext;
  const limit = tokenNumber(Number(raw));
  return limit && limit > 0 ? limit : undefined;
}

export function promptText(value: unknown): string {
  if (typeof value === "string")
    return /^data:(?:image|audio|video)\//i.test(value) ? "" : value;
  if (Array.isArray(value))
    return value.map(promptText).filter(Boolean).join("\n");
  const item = record(value);
  if (!item) return "";
  return [
    item.content,
    item.text,
    item.tool_calls,
    item.function,
    item.arguments,
  ]
    .map(promptText)
    .filter(Boolean)
    .join("\n");
}

export function completeApiUsage(
  usage: ApiUsage | undefined,
):
  | { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  | undefined {
  if (
    usage?.input === undefined ||
    usage.output === undefined ||
    usage.total === undefined
  )
    return undefined;
  return {
    prompt_tokens: usage.input,
    completion_tokens: usage.output,
    total_tokens: usage.total,
  };
}
