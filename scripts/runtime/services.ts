import type { HostAdapter, CarrierTarget } from "../../shared/host/adapter.ts";
import {
  isJsonValue,
  parseEnvelope,
  type JsonValue,
  type ServiceEnvelope,
  type ServiceProvider,
} from "../../shared/contracts/services.ts";
import type {
  ModuleManifest,
  ModuleServices,
  ServiceHandler,
} from "../../shared/contracts/module.ts";
import { Lifecycle } from "./lifecycle.ts";
import { selectProvider } from "./ownership.ts";

interface Peer {
  providers: ServiceProvider[];
  seen: number;
}
interface Handler {
  protocol: number;
  callback: ServiceHandler;
  lifecycle: Lifecycle;
}
interface Pending {
  provider: ServiceProvider;
  resolve: (value: JsonValue) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}
export class ServiceBridge {
  private readonly peers = new Map<string, Peer>();
  private readonly handlers = new Map<string, Handler>();
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<() => void>();
  private readonly responses = new Map<string, Promise<ServiceEnvelope>>();
  private readonly incoming = new Map<
    string,
    { sender: string; generation: number; controller: AbortController }
  >();
  private requestSequence = 0;
  private readonly receivedSequences = new Map<string, number>();
  private readonly remoteGenerations = new Map<string, number>();
  constructor(
    private readonly host: HostAdapter,
    readonly instanceId: string,
    readonly generation: number,
    private readonly target: CarrierTarget,
    private readonly lifecycle: Lifecycle,
  ) {
    lifecycle.defer(host.listenMessages((text) => this.receive(text)));
    lifecycle.defer(() => {
      this.send({ type: "withdraw", providers: this.localProviders() });
      this.handlers.clear();
      for (const request of this.incoming.values())
        request.controller.abort(new Error("Service bridge closed."));
      this.incoming.clear();
      for (const id of [...this.pending.keys()])
        this.fail(id, new Error("Service bridge closed."));
      this.peers.clear();
      this.listeners.clear();
      this.responses.clear();
      this.remoteGenerations.clear();
      this.receivedSequences.clear();
    });
    lifecycle.interval(() => {
      const now = Date.now();
      for (const [id, peer] of this.peers)
        if (now - peer.seen > 15000) {
          this.peers.delete(id);
          this.cancelIncoming(id);
          this.changed();
        }
      this.send({ type: "discover" });
      this.announce();
    }, 5000);
    this.send({ type: "discover" });
  }
  private send(
    data: Omit<
      ServiceEnvelope,
      "channel" | "version" | "sender" | "generation"
    >,
  ): void {
    this.host.sendMessage(
      JSON.stringify({
        ...data,
        channel: "loreloom.services",
        version: 1,
        sender: this.instanceId,
        generation: this.generation,
      }),
    );
  }
  private localProviders(): ServiceProvider[] {
    return [...this.handlers].map(([service, handler]) => ({
      service,
      scriptId: this.host.scriptId,
      protocol: handler.protocol,
      target: this.target,
      instanceId: this.instanceId,
      generation: this.generation,
    }));
  }
  private announce(): void {
    this.send({ type: "announce", providers: this.localProviders() });
  }
  private changed(): void {
    for (const [id, pending] of this.pending) {
      const current = this.providers().find(
        (provider) =>
          provider.instanceId === pending.provider.instanceId &&
          provider.generation === pending.provider.generation &&
          provider.service === pending.provider.service &&
          provider.protocol === pending.provider.protocol,
      );
      if (!current) this.fail(id, new Error("Service provider disconnected."));
    }
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error("Service listener failed.", error);
      }
    }
  }
  private providers(): ServiceProvider[] {
    return [
      ...this.localProviders(),
      ...[...this.peers.values()].flatMap((peer) => peer.providers),
    ];
  }
  find(service: string, protocol: number): ServiceProvider | undefined {
    return selectProvider(
      this.providers(),
      service,
      protocol,
      this.host.scriptOrder(),
    );
  }
  subscribe(callback: () => void): () => void {
    this.lifecycle.assertActive();
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }
  private cancelIncoming(sender: string): void {
    for (const request of this.incoming.values()) {
      if (request.sender === sender)
        request.controller.abort(
          new Error("Request sender disconnected or changed context."),
        );
    }
  }
  private fail(id: string, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    pending.cleanup();
    pending.reject(error);
  }
  private receive(text: string): void {
    if (this.lifecycle.signal.aborted) return;
    let envelope: ServiceEnvelope | null;
    try {
      envelope = parseEnvelope(JSON.parse(text));
    } catch {
      return;
    }
    if (!envelope || (envelope.target && envelope.target !== this.instanceId))
      return;
    const request = envelope;
    const knownGeneration = this.remoteGenerations.get(request.sender) ?? -1;
    if (request.generation < knownGeneration) return;
    if (request.generation > knownGeneration)
      this.cancelIncoming(request.sender);
    this.remoteGenerations.set(request.sender, request.generation);
    if (request.type === "discover") {
      this.announce();
      return;
    }
    if (request.type === "announce" && request.sender !== this.instanceId) {
      const providers = request.providers!;
      const previous = this.peers.get(request.sender)?.providers;
      this.peers.set(request.sender, { providers, seen: Date.now() });
      if (JSON.stringify(previous) !== JSON.stringify(providers))
        this.changed();
      return;
    }
    if (request.type === "withdraw") {
      this.cancelIncoming(request.sender);
      if (this.peers.delete(request.sender)) this.changed();
      return;
    }
    if (request.type === "response") {
      const pending = this.pending.get(request.requestId!);
      if (
        !pending ||
        request.sender !== pending.provider.instanceId ||
        request.generation !== pending.provider.generation ||
        request.targetGeneration !== this.generation ||
        request.service !== pending.provider.service ||
        request.protocol !== pending.provider.protocol
      )
        return;
      this.pending.delete(request.requestId!);
      pending.cleanup();
      if (request.error) pending.reject(new Error(request.error));
      else pending.resolve(request.payload ?? null);
      return;
    }
    if (
      request.type !== "request" ||
      request.targetGeneration !== this.generation
    )
      return;
    const handler = this.handlers.get(request.service!);
    const cacheKey = `${request.sender}:${request.generation}:${request.requestId}`;
    let response = this.responses.get(cacheKey);
    if (!response) {
      const sequence = Number(request.requestId);
      const sourceKey = `${request.sender}:${request.generation}`;
      if (
        !Number.isSafeInteger(sequence) ||
        sequence < 1 ||
        sequence <= (this.receivedSequences.get(sourceKey) ?? 0)
      ) {
        this.send({
          type: "response",
          target: request.sender,
          targetGeneration: request.generation,
          requestId: request.requestId,
          service: request.service,
          protocol: request.protocol,
          error: "Expired or invalid request. Reload state before retrying.",
        });
        return;
      }
      this.receivedSequences.set(sourceKey, sequence);
      const controller = new AbortController();
      this.incoming.set(cacheKey, {
        sender: request.sender,
        generation: request.generation,
        controller,
      });
      response = Promise.resolve().then(async (): Promise<ServiceEnvelope> => {
        const base: ServiceEnvelope = {
          channel: "loreloom.services",
          version: 1,
          sender: this.instanceId,
          generation: this.generation,
          type: "response",
          target: request.sender,
          targetGeneration: request.generation,
          requestId: request.requestId,
          service: request.service,
          protocol: request.protocol,
        };
        try {
          if (!handler || handler.protocol !== request.protocol)
            throw new Error("Service protocol is unavailable.");
          handler.lifecycle.assertActive();
          const signal = AbortSignal.any([
            handler.lifecycle.signal,
            controller.signal,
          ]);
          signal.throwIfAborted();
          const payload = await handler.callback(
            request.method!,
            request.payload ?? null,
            {
              sender: request.sender,
              generation: request.generation,
              signal,
            },
          );
          signal.throwIfAborted();
          if (!isJsonValue(payload))
            throw new Error("Service response must be serializable.");
          return { ...base, payload };
        } catch (error) {
          return {
            ...base,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });
      response = response.finally(() => {
        this.incoming.delete(cacheKey);
      });
      this.responses.set(cacheKey, response);
      if (this.responses.size > 512)
        this.responses.delete(this.responses.keys().next().value!);
    }
    void response
      .then((result) => {
        if (!this.lifecycle.signal.aborted)
          this.host.sendMessage(JSON.stringify(result));
      })
      .catch(console.error);
  }
  forModule(manifest: ModuleManifest, lifecycle: Lifecycle): ModuleServices {
    const declaration = (service: string) => {
      const use = manifest.uses.find((entry) => entry.service === service);
      if (!use)
        throw new Error(`Undeclared service use: ${manifest.id}/${service}`);
      return use;
    };
    const requestProvider = (
      provider: ServiceProvider,
      method: string,
      payload: JsonValue,
      options: { signal?: AbortSignal; timeout?: number } = {},
    ): Promise<JsonValue> => {
      if (!method || !isJsonValue(payload))
        return Promise.reject(new Error("Invalid service request."));
      const timeout = options.timeout ?? 10000;
      if (!Number.isFinite(timeout) || timeout <= 0)
        return Promise.reject(new Error("Invalid service timeout."));
      const signal = options.signal
        ? AbortSignal.any([lifecycle.signal, options.signal])
        : lifecycle.signal;
      if (signal.aborted) return Promise.reject(signal.reason);
      const requestId = String(++this.requestSequence);
      return new Promise<JsonValue>((resolve, reject) => {
        const abort = () =>
          this.fail(requestId, new Error("Service request canceled."));
        const timer = setTimeout(
          () =>
            this.fail(
              requestId,
              new Error(
                "Service request timed out. Reload state before retrying.",
              ),
            ),
          timeout,
        );
        const cleanup = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
        };
        this.pending.set(requestId, { provider, resolve, reject, cleanup });
        signal.addEventListener("abort", abort, { once: true });
        try {
          this.send({
            type: "request",
            target: provider.instanceId,
            targetGeneration: provider.generation,
            service: provider.service,
            protocol: provider.protocol,
            requestId,
            method,
            payload,
          });
        } catch (error) {
          this.fail(
            requestId,
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      });
    };
    return {
      provide: (service, callback) => {
        lifecycle.assertActive();
        const declaration = manifest.provides.find(
          (entry) => entry.service === service,
        );
        if (
          !declaration ||
          this.handlers.has(service) ||
          (service === "settings-panel" && this.target !== "preset")
        )
          throw new Error(`Service cannot be provided: ${service}`);
        const handler = { protocol: declaration.protocol, callback, lifecycle };
        this.handlers.set(service, handler);
        this.announce();
        this.changed();
        const dispose = () => {
          if (this.handlers.get(service) !== handler) return;
          this.handlers.delete(service);
          this.announce();
          this.changed();
        };
        lifecycle.defer(dispose);
        return dispose;
      },
      find: (service) => {
        lifecycle.assertActive();
        const entry =
          manifest.uses.find((item) => item.service === service) ??
          manifest.provides.find((item) => item.service === service);
        if (!entry) throw new Error(`Undeclared service: ${service}`);
        return this.find(service, entry.protocol);
      },
      connectSettings: (service, protocol) => {
        lifecycle.assertActive();
        // Only the active settings panel can connect to dynamic feature endpoints.
        const panel = this.handlers.get("settings-panel");
        if (
          !manifest.provides.some(
            (entry) => entry.service === "settings-panel",
          ) ||
          !panel ||
          panel.lifecycle !== lifecycle ||
          this.find("settings-panel", panel.protocol)?.instanceId !==
            this.instanceId
        )
          throw new Error(
            "Only the active settings panel may connect settings.",
          );
        if (!/^[a-z][a-z0-9-]*-settings$/.test(service) || protocol !== 1)
          throw new Error("Unsupported settings endpoint.");
        const provider = this.find(service, protocol);
        if (!provider) return undefined;
        return {
          provider: Object.freeze({ ...provider }),
          request: (method, payload) => {
            lifecycle.assertActive();
            const current = this.find(service, protocol);
            if (
              this.handlers.get("settings-panel") !== panel ||
              this.find("settings-panel", panel.protocol)?.instanceId !==
                this.instanceId ||
              current?.instanceId !== provider.instanceId ||
              current?.generation !== provider.generation
            )
              return Promise.reject(
                new Error("Settings provider disconnected or changed."),
              );
            if (!["read", "update", "action"].includes(method))
              return Promise.reject(new Error("Unknown settings method."));
            return requestProvider(provider, method, payload);
          },
        };
      },
      subscribe: (callback) => {
        lifecycle.assertActive();
        const dispose = this.subscribe(callback);
        lifecycle.defer(dispose);
        return dispose;
      },
      request: (service, method, payload, options = {}) => {
        lifecycle.assertActive();
        const use = declaration(service);
        const provider = this.find(service, use.protocol);
        if (!provider)
          return Promise.reject(new Error(`Service unavailable: ${service}`));
        return requestProvider(provider, method, payload, options);
      },
    };
  }
}
