import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import type { UsageHost } from "../runtime/host.ts";
import { record } from "../domain/usage.ts";
import { prepareStreamingBody } from "./request-body.ts";
import { readGenerationResponse, type GenerationResponse } from "./response.ts";
export function observeApiUsage(
  context: ModuleContext,
  host: UsageHost,
  isActive: () => boolean,
  getExtraBody: () => string,
  capture: (
    body: Record<string, unknown>,
    usage: Promise<GenerationResponse | undefined>,
  ) => void,
): () => void {
  const parent = context.host.window;
  const original = parent.fetch;
  let enabled = true;
  const controller = new AbortController();
  const pending = new Set<(usage: GenerationResponse | undefined) => void>();
  const wrapped: typeof fetch = async (input, init) => {
    if (!enabled || !isActive() || !host.isCurrent())
      return original.call(parent, input, init);
    const raw =
      typeof input === "string"
        ? input
        : "url" in input
          ? input.url
          : input.toString();
    const url = new URL(raw, parent.location.href);
    if (
      url.origin !== parent.location.origin ||
      ![
        "/api/backends/chat-completions/generate",
        "/api/backends/text-completions/generate",
      ].includes(url.pathname)
    )
      return original.call(parent, input, init);
    let text = typeof init?.body === "string" ? init.body : undefined;
    if (
      text === undefined &&
      init?.body === undefined &&
      "clone" in Object(input)
    ) {
      try {
        text = await (input as Request).clone().text();
      } catch {
        /* Keep unreadable requests intact. */
      }
    }
    let body: Record<string, unknown> | undefined;
    try {
      body = text === undefined ? undefined : record(JSON.parse(text));
    } catch {
      /* Non-JSON requests pass through. */
    }
    if (
      !body ||
      !enabled ||
      !isActive() ||
      !host.isCurrent() ||
      body.type === "quiet" ||
      body.type === "impersonate"
    )
      return original.call(parent, input, init);
    const prepared = prepareStreamingBody(body, getExtraBody, host.parseYaml);
    let resolve: (usage: GenerationResponse | undefined) => void = () => {};
    const usage = new Promise<GenerationResponse | undefined>((done) => {
      resolve = (value) => {
        pending.delete(resolve);
        done(value);
      };
      pending.add(resolve);
    });
    try {
      capture(body, usage);
    } catch (error) {
      console.warn(
        "Could not associate a generation request with token usage.",
        error,
      );
      resolve(undefined);
    }
    try {
      const response = await original.call(
        parent,
        input,
        prepared === body ? init : { ...init, body: JSON.stringify(prepared) },
      );
      if (!response.ok || !enabled || controller.signal.aborted)
        resolve(undefined);
      else {
        try {
          void readGenerationResponse(response.clone(), controller.signal)
            .then(resolve)
            .catch((error) => {
              if (enabled)
                console.warn("Could not read API token usage.", error);
              resolve(undefined);
            });
        } catch {
          resolve(undefined);
        }
      }
      return response;
    } catch (error) {
      resolve(undefined);
      throw error;
    }
  };
  parent.fetch = wrapped;
  return () => {
    enabled = false;
    controller.abort();
    for (const resolve of pending) resolve(undefined);
    pending.clear();
    if (parent.fetch === wrapped) parent.fetch = original;
  };
}
