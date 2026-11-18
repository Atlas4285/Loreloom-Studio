import {
  promptText,
  readApiUsage,
  record,
  type ApiUsage,
} from "../domain/usage.ts";
export interface ResponseToolCall {
  id?: string;
  name: string;
  arguments: string;
}
export interface GenerationResponse {
  usage?: ApiUsage;
  kind?: "assistant" | "tool_call";
  toolCalls: ResponseToolCall[];
  text: string;
  reasoning: string;
  outputCaptured: boolean;
  complete: boolean;
}
export async function readGenerationResponse(
  response: Response,
  signal: AbortSignal,
): Promise<GenerationResponse> {
  const result: GenerationResponse = {
    toolCalls: [],
    text: "",
    reasoning: "",
    outputCaptured: false,
    complete: false,
  };
  if (!response.body || signal.aborted) return result;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map<number, ResponseToolCall>();
  let line = "",
    whole = "",
    keepWhole = true,
    keepOutput = true;
  let outputSize = 0;
  const limit = 4 * 1024 * 1024;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  function output(value: unknown, reasoning = false, delta = false): void {
    if (value === undefined || value === null || !keepOutput) return;
    const text = promptText(value);
    outputSize += text.length;
    if (outputSize > limit) {
      keepOutput = false;
      result.text = result.reasoning = "";
      return;
    }
    result.outputCaptured = true;
    const key = reasoning ? "reasoning" : "text";
    result[key] = delta ? result[key] + text : text;
  }
  function tool(value: unknown, position: number, delta: boolean): void {
    const entry = record(value);
    if (!entry) return;
    const fn = record(entry.function) ?? entry;
    const index = typeof entry.index === "number" ? entry.index : position;
    const call = calls.get(index) ?? { name: "", arguments: "" };
    if (typeof entry.id === "string") call.id = entry.id;
    if (typeof fn.name === "string")
      call.name = delta ? call.name + fn.name : fn.name;
    if (typeof fn.arguments === "string" && keepOutput) {
      outputSize += fn.arguments.length;
      if (outputSize > limit) {
        keepOutput = false;
        result.text = result.reasoning = "";
      } else
        call.arguments = delta ? call.arguments + fn.arguments : fn.arguments;
    }
    calls.set(index, call);
    result.kind = "tool_call";
  }
  function consumeValue(value: unknown): void {
    const data = record(value);
    if (!data) return;
    const usage = readApiUsage(value);
    if (usage)
      result.usage = {
        input: usage.input ?? result.usage?.input,
        output: usage.output ?? result.usage?.output,
        total: usage.total ?? result.usage?.total,
      };
    const choice = Array.isArray(data.choices)
      ? record(data.choices[0])
      : undefined;
    const delta = record(choice?.delta);
    const message = record(choice?.message) ?? record(data.message);
    const content = delta ?? message;
    if (content) {
      output(content.content, false, !!delta);
      output(
        content.reasoning_content ??
          content.reasoning ??
          content.reasoning_details,
        true,
        !!delta,
      );
      if (Array.isArray(content.tool_calls))
        content.tool_calls.forEach((item, index) => tool(item, index, !!delta));
      if (content.function_call) tool(content.function_call, 0, !!delta);
    }
    // Native Claude streams expose blocks instead of OpenAI choices.
    const blocks = Array.isArray(data.content) ? data.content : [];
    blocks.forEach((item, index) => {
      const block = record(item);
      if (block?.type === "tool_use")
        tool(
          {
            id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
          index,
          false,
        );
      else if (block?.type === "thinking") output(block.thinking, true, true);
      else if (block?.type === "text") output(block.text, false, true);
    });
    const block = record(data.content_block);
    if (block?.type === "tool_use")
      tool(
        { index: data.index, id: block.id, name: block.name, arguments: "" },
        0,
        false,
      );
    else if (block?.type === "text") output(block.text, false, true);
    else if (block?.type === "thinking") output(block.thinking, true, true);
    const blockDelta = record(data.delta);
    if (blockDelta?.type === "input_json_delta")
      tool({ index: data.index, arguments: blockDelta.partial_json }, 0, true);
    else if (blockDelta?.type === "text_delta")
      output(blockDelta.text, false, true);
    else if (blockDelta?.type === "thinking_delta")
      output(blockDelta.thinking, true, true);
    const stop = data.stop_reason ?? blockDelta?.stop_reason;
    if (stop === "tool_use") result.kind = "tool_call";
    else if (stop && result.kind !== "tool_call") result.kind = "assistant";
    const candidate = Array.isArray(data.candidates)
      ? record(data.candidates[0])
      : undefined;
    const google = record(candidate?.content) ?? record(data.responseContent);
    if (Array.isArray(google?.parts))
      google.parts.forEach((item, index) => {
        const part = record(item),
          fn = record(part?.functionCall);
        if (fn)
          tool(
            { name: fn.name, arguments: JSON.stringify(fn.args ?? {}) },
            index,
            false,
          );
        else if (part?.text !== undefined)
          output(part.text, part.thought === true, true);
      });
    if (choice?.text !== undefined) output(choice.text, false, !message);
    const results = Array.isArray(data.results)
      ? record(data.results[0])
      : undefined;
    if (results?.text !== undefined) output(results.text);
    if (data.token !== undefined && typeof data.token === "string")
      output(data.token, false, true);
    if (
      choice?.finish_reason === "tool_calls" ||
      choice?.finish_reason === "function_call"
    )
      result.kind = "tool_call";
    else if (choice?.finish_reason && result.kind !== "tool_call")
      result.kind = "assistant";
  }
  function consume(text: string): void {
    const data = text.startsWith("data:") ? text.slice(5).trim() : text.trim();
    if (!data || data === "[DONE]" || data.startsWith(":")) return;
    try {
      consumeValue(JSON.parse(data));
    } catch {
      /* Stream control lines. */
    }
  }
  function append(text: string): void {
    if (keepWhole) {
      if (whole.length + text.length <= limit) whole += text;
      else {
        keepWhole = false;
        whole = "";
      }
    }
    line += text;
    let newline: number;
    while ((newline = line.indexOf("\n")) >= 0) {
      consume(line.slice(0, newline).replace(/\r$/, ""));
      line = line.slice(newline + 1);
    }
    if (line.length > limit) line = "";
  }
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) {
        result.complete = !signal.aborted;
        break;
      }
      append(decoder.decode(chunk.value, { stream: true }));
    }
    append(decoder.decode());
    if (line) consume(line);
    if (keepWhole) {
      try {
        // Pretty-printed JSON has not been consumed as a complete value yet.
        const value = JSON.parse(whole);
        // Replacing full message fields is idempotent; usage fields are snapshots.
        calls.clear();
        result.text = result.reasoning = "";
        result.outputCaptured = false;
        result.kind = undefined;
        outputSize = 0;
        keepOutput = true;
        consumeValue(value);
      } catch {
        /* SSE is handled line by line. */
      }
    }
  } catch {
    result.complete = false;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  result.toolCalls = [...calls.values()];
  result.outputCaptured =
    keepOutput && (result.outputCaptured || calls.size > 0);
  return result;
}
export async function readResponseUsage(
  response: Response,
  signal: AbortSignal,
): Promise<ApiUsage | undefined> {
  return (await readGenerationResponse(response, signal)).usage;
}
