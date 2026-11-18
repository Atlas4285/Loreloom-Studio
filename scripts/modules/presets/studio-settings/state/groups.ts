import type {
  ModuleContext,
  ServiceRequest,
  ServiceConnection,
} from "../../../../../shared/contracts/module.ts";
import type { JsonValue } from "../../../../../shared/contracts/services.ts";
import type {
  SettingsGroup,
  SettingsValues,
} from "../../../../../shared/contracts/settings.ts";
import { identity, parseGroup, parseReply, record } from "../protocol/parse.ts";
export interface GroupState {
  key: string;
  group: SettingsGroup;
  pending: number;
  failed: boolean;
  reason?: "conflict" | "timeout";
  queue: Promise<void>;
}
export class SettingsGroups {
  private readonly groups = new Map<string, GroupState>();
  private readonly unavailableSince = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  constructor(private readonly context: ModuleContext) {}
  readonly isActive = () =>
    !this.context.signal.aborted &&
    this.context.services.find("settings-panel")?.instanceId ===
      this.context.instanceId;
  subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
  list(): GroupState[] {
    const order = this.context.host.scriptOrder();
    const rank = (state: GroupState) => {
      const scope = JSON.parse(state.group.scope) as { scriptId: string };
      const index = order.indexOf(scope.scriptId);
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };
    return [...this.groups.values()]
      .filter((state) => this.connected(state.group))
      .sort(
        (a, b) =>
          rank(a) - rank(b) ||
          a.group.moduleId.localeCompare(b.group.moduleId) ||
          a.key.localeCompare(b.key),
      );
  }
  private current(state: GroupState): boolean {
    return (
      this.isActive() &&
      this.groups.get(state.key) === state &&
      this.connected(state.group)
    );
  }
  private endpoint(group: SettingsGroup): ServiceConnection | undefined {
    if (!this.isActive()) return undefined;
    const connection = this.context.services.connectSettings(
      group.endpoint.service,
      group.endpoint.protocol,
    );
    return connection?.provider.instanceId === group.instanceId &&
      connection.provider.generation === group.generation
      ? connection
      : undefined;
  }
  private connected(group: SettingsGroup): boolean {
    return this.endpoint(group) !== undefined;
  }
  private request(
    group: SettingsGroup,
    method: "read" | "update" | "action",
    payload: JsonValue,
  ): Promise<JsonValue> {
    const endpoint = this.endpoint(group);
    if (!endpoint)
      return Promise.reject(
        new Error("Settings provider disconnected or changed."),
      );
    return endpoint.request(method, payload);
  }
  handle = (
    method: string,
    payload: JsonValue,
    request: ServiceRequest,
  ): JsonValue => {
    request.signal.throwIfAborted();
    if (!this.isActive())
      throw new Error("Settings panel is not the active provider.");
    if (method === "register") {
      const group = parseGroup(payload);
      if (
        group.instanceId !== request.sender ||
        group.generation !== request.generation ||
        !this.connected(group)
      )
        throw new Error("Untrusted settings provider.");
      const scope: unknown = JSON.parse(group.scope);
      const current = this.context.host.scope();
      const provider = this.endpoint(group)?.provider;
      if (
        !record(scope) ||
        !["preset", "character"].includes(String(scope.target)) ||
        typeof scope.scriptId !== "string" ||
        scope.target !== provider?.target ||
        (provider?.scriptId !== undefined &&
          scope.scriptId !== provider.scriptId) ||
        scope.chatId !== current.chatId ||
        scope.characterId !== current.characterId ||
        scope.groupId !== current.groupId
      )
        throw new Error("Settings context has changed.");
      const key = `${group.instanceId}:${group.generation}:${group.groupId}`;
      this.unavailableSince.delete(key);
      const existing = this.groups.get(key);
      if (existing) {
        if (
          existing.group.scope !== group.scope ||
          existing.group.snapshot.version !== group.snapshot.version ||
          JSON.stringify(existing.group.fields) !== JSON.stringify(group.fields)
        )
          throw new Error("Settings schema changed within a generation.");
        if (group.snapshot.revision >= existing.group.snapshot.revision)
          existing.group = group;
      } else
        this.groups.set(key, {
          key,
          group,
          pending: 0,
          failed: false,
          queue: Promise.resolve(),
        });
      this.emit();
      return true;
    }
    if (method === "unregister" && record(payload)) {
      for (const [key, state] of this.groups)
        if (
          state.group.instanceId === request.sender &&
          state.group.generation === request.generation &&
          state.group.groupId === payload.groupId &&
          state.group.scope === payload.scope &&
          state.group.generation === payload.generation
        ) {
          this.groups.delete(key);
          this.unavailableSince.delete(key);
        }
      this.emit();
      return true;
    }
    throw new Error("Unknown settings panel method.");
  };
  sync(): void {
    if (!this.isActive()) {
      this.groups.clear();
      this.unavailableSince.clear();
    } else {
      const now = Date.now();
      for (const [key, state] of this.groups) {
        if (this.connected(state.group)) {
          this.unavailableSince.delete(key);
          continue;
        }
        // Keep registration metadata briefly so older clients can recover
        // without changing the wire protocol or waiting for a settings edit.
        const since = this.unavailableSince.get(key) ?? now;
        this.unavailableSince.set(key, since);
        if (now - since >= 30000) {
          this.groups.delete(key);
          this.unavailableSince.delete(key);
        }
      }
    }
    this.emit();
  }
  private async read(state: GroupState): Promise<void> {
    const group = state.group;
    const result = await this.request(group, "read", identity(group));
    if (this.current(state)) {
      const next = parseReply(result, group);
      if (next.revision >= state.group.snapshot.revision)
        state.group.snapshot = next;
    }
  }
  refresh(): void {
    for (const state of this.list()) {
      if (state.pending) continue;
      void this.read(state)
        .then(() => {
          if (this.current(state)) {
            state.failed = false;
            this.emit();
          }
        })
        .catch(() => {
          if (this.current(state)) {
            state.failed = true;
            this.emit();
          }
        });
    }
  }
  update(state: GroupState, patch: SettingsValues): void {
    this.enqueue(state, async () => {
      const group = state.group;
      const expectedRevision = group.snapshot.revision;
      const result = await this.request(group, "update", {
        ...identity(group),
        expectedRevision,
        values: { ...group.snapshot.values, ...patch },
      });
      const next = parseReply(result, group);
      if (next.revision <= expectedRevision)
        throw new Error("Settings update was not committed.");
      if (this.current(state) && next.revision >= state.group.snapshot.revision)
        state.group.snapshot = next;
    });
  }
  action(state: GroupState, id: string, value: string): void {
    this.enqueue(state, async () => {
      const group = state.group;
      const result = await this.request(group, "action", {
        ...identity(group),
        expectedRevision: group.snapshot.revision,
        id,
        value,
      });
      const next = parseReply(result, group);
      if (this.current(state) && next.revision >= state.group.snapshot.revision)
        state.group.snapshot = next;
    });
  }
  private enqueue(state: GroupState, task: () => Promise<void>): void {
    if (!this.current(state)) return;
    state.pending++;
    state.failed = false;
    this.emit();
    state.queue = state.queue
      .then(async () => {
        if (!this.current(state)) return;
        try {
          await task();
        } catch (error) {
          if (this.current(state)) {
            state.failed = true;
            const detail =
              error instanceof Error ? error.message : String(error);
            state.reason = /revision conflict/i.test(detail)
              ? "conflict"
              : /timed out|timeout/i.test(detail)
                ? "timeout"
                : undefined;
            console.warn("Could not save settings.", error);
            await this.read(state).catch(() => {});
          }
        }
      })
      .finally(() => {
        state.pending--;
        if (this.current(state)) this.emit();
      });
  }
  dispose(): void {
    this.groups.clear();
    this.unavailableSince.clear();
    this.listeners.clear();
  }
}
