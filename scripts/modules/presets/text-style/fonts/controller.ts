import type {
  ModuleContext,
  ModuleSettings,
} from "../../../../../shared/contracts/module.ts";
import type {
  ResourceOption,
  ResourceStates,
} from "../../../../../shared/contracts/resources.ts";
import { localizedName } from "../../../../../shared/contracts/names.ts";
import bundledCatalog from "../../../../../fonts/catalog.json";
import {
  CATALOG_URL,
  fontSignature,
  parseCatalog,
  readBytes,
  verifyFont,
  type FontCatalog,
  type FontEntry,
} from "./catalog.ts";
import { FontStorage, type FontStore, type InstalledFont } from "./storage.ts";
import { fontMessages as messages } from "./messages.ts";
import { FontCache, type LoadedFont } from "./cache.ts";

interface Job {
  label: string;
  progress?: number;
}
const DAY = 24 * 60 * 60 * 1000;

export class FontController {
  private readonly storage: FontStorage;
  private readonly cache: FontCache;
  private readonly nameOrder: Intl.Collator;
  private readonly listeners = new Set<() => void>();
  private readonly jobs = new Map<string, Job>();
  private readonly ready = new Set<string>();
  private readonly failures = new Map<string, string>();
  private readonly loaded = new Map<string, LoadedFont>();
  private readonly loading = new Map<string, Job>();
  private appliedId = "default";
  private catalog: FontCatalog = parseCatalog(bundledCatalog);
  private store: FontStore = { schemaVersion: 1, installed: {} };
  private settings?: ModuleSettings;
  private initialized = false;
  private refreshing = false;
  private notice?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly scope: string;

  constructor(
    private readonly context: ModuleContext,
    private readonly isActive: () => boolean,
    private readonly refresh: () => void,
  ) {
    this.storage = new FontStorage(context);
    this.cache = new FontCache(context.host.document);
    this.nameOrder = new Intl.Collator(
      context.locale === "zh-CN" ? "zh-CN-u-co-pinyin" : "en",
      { sensitivity: "base" },
    );
    this.scope = JSON.stringify(context.scope);
    context.lifecycle.defer(() => {
      clearTimeout(this.timer);
      this.listeners.clear();
      this.loaded.clear();
    });
  }
  bind(settings: ModuleSettings): void {
    this.settings = settings;
  }
  subscribe = (notify: () => void): (() => void) => {
    this.listeners.add(notify);
    return () => {
      this.listeners.delete(notify);
    };
  };
  private current(): boolean {
    try {
      return (
        !this.context.signal.aborted &&
        this.isActive() &&
        JSON.stringify(this.context.host.scope()) === this.scope
      );
    } catch {
      return false;
    }
  }
  private assertCurrent(): void {
    this.context.signal.throwIfAborted();
    if (!this.current()) throw new Error("Font context has changed.");
  }
  private emit(throttle = false): void {
    if (throttle) {
      this.timer ??= setTimeout(() => {
        this.timer = undefined;
        this.emit();
      }, 100);
      return;
    }
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.current()) return;
    for (const notify of this.listeners) notify();
    this.refresh();
  }
  private error(error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error);
    return this.context.translate(messages.failed, {
      error: detail.slice(0, 400),
    });
  }
  private fonts(): FontEntry[] {
    return [
      ...this.catalog.fonts,
      ...Object.values(this.store.installed)
        .map((entry) => entry.font)
        .filter(
          (font) => !this.catalog.fonts.some((entry) => entry.id === font.id),
        ),
    ].sort(
      (left, right) =>
        this.nameOrder.compare(
          localizedName(left.name, this.context.locale),
          localizedName(right.name, this.context.locale),
        ) || left.id.localeCompare(right.id),
    );
  }
  private hasUpdate(font: FontEntry): boolean {
    const installed = this.store.installed[font.id]?.font;
    return (
      !!installed &&
      (font.revision > installed.revision ||
        (font.revision >= installed.revision &&
          fontSignature(font) !== fontSignature(installed)))
    );
  }
  state = (): ResourceStates => {
    const t = this.context.translate;
    const options: ResourceOption[] = [
      { value: "default", label: t(messages.default), available: true },
    ];
    for (const font of this.fonts()) {
      const job = this.jobs.get(font.id);
      const loading = this.loading.get(font.id);
      const installed = this.store.installed[font.id];
      const available = this.ready.has(font.id);
      const update = available && this.hasUpdate(font);
      const version = installed?.font.version ?? font.version;
      const size = (
        font.files.reduce((sum, file) => sum + file.bytes, 0) /
        1024 /
        1024
      ).toFixed(1);
      options.push({
        value: font.id,
        label: localizedName(font.name, this.context.locale),
        available: available && job?.label !== t(messages.deleting),
        description: `${version}${update ? ` → ${font.version}` : ""} · ${size} MB`,
        ...(job ? { activity: job.label } : {}),
        ...(job?.progress !== undefined ? { progress: job.progress } : {}),
        ...(loading
          ? { loading }
          : job?.label === t(messages.checking)
            ? { loading: job }
            : {}),
        actions: [
          ...(!available || update
            ? [
                {
                  value: `${update ? "update" : "download"}:${font.id}`,
                  label:
                    job?.label ??
                    loading?.label ??
                    t(update ? messages.update : messages.download),
                  disabled:
                    !!job ||
                    !!loading ||
                    !this.initialized ||
                    !this.storage.available,
                },
              ]
            : []),
          ...(installed
            ? [
                {
                  value: `delete:${font.id}`,
                  label: !update
                    ? (job?.label ?? loading?.label ?? t(messages.remove))
                    : t(messages.remove),
                  disabled: !!job || !!loading,
                },
              ]
            : []),
        ],
      });
    }
    const failure = [...this.failures.entries()].at(-1);
    const failedFont =
      failure && this.fonts().find((font) => font.id === failure[0]);
    const failureMessage = failure
      ? `${failedFont ? localizedName(failedFont.name, this.context.locale) : failure[0]}: ${failure[1]}`
      : undefined;
    return {
      fontId: {
        options,
        ...(!this.storage.available
          ? { message: t(messages.helperRequired) }
          : this.notice || failureMessage || this.refreshing
            ? {
                message:
                  this.notice ?? failureMessage ?? t(messages.refreshing),
              }
            : {}),
        onOpen: {
          value: "refresh",
          label: t(messages.refreshing),
          disabled:
            this.refreshing || !this.storage.available || !this.initialized,
        },
      },
    };
  };
  start(): void {
    if (this.initialized || !this.storage.available || !this.current()) return;
    this.initialized = true;
    void this.initialize().catch((error) => {
      this.notice = this.error(error);
      this.emit();
    });
  }
  private async initialize(): Promise<void> {
    this.store = this.storage.readStore();
    if (
      this.store.catalog &&
      this.store.catalog.revision >= this.catalog.revision
    )
      this.catalog = this.store.catalog;
    await Promise.all(
      Object.entries(this.store.installed).map(async ([id, entry]) => {
        const cached = this.cache.get(entry.font);
        if (cached) {
          this.loaded.set(id, cached);
          this.ready.add(id);
          return;
        }
        this.jobs.set(id, { label: this.context.translate(messages.checking) });
        this.emit();
        try {
          for (const file of entry.files) {
            const response = await this.storage.read(file.filename);
            const exists = response.ok;
            await response.body?.cancel();
            if (!exists) throw new Error("Server font file is missing.");
          }
          this.assertCurrent();
          this.ready.add(id);
        } catch {
          this.failures.set(id, this.context.translate(messages.missing));
          this.resetSelection(id);
        } finally {
          this.jobs.delete(id);
          this.emit();
        }
      }),
    );
    this.assertCurrent();
    if (!this.store.checkedAt || Date.now() - this.store.checkedAt > DAY)
      await this.refreshCatalog();
    this.emit();
  }
  action(value: string): void {
    this.assertCurrent();
    if (value === "refresh") {
      if (!this.refreshing) void this.refreshCatalog();
      return;
    }
    const [operation, id] = value.split(":");
    const font = this.fonts().find((entry) => entry.id === id);
    if (
      !font ||
      !["download", "update", "delete"].includes(operation!) ||
      this.jobs.has(font.id)
    )
      throw new Error("Unknown font action.");
    this.failures.delete(font.id);
    this.jobs.set(font.id, {
      label: this.context.translate(
        operation === "delete" ? messages.deleting : messages.downloading,
        { progress: 0 },
      ),
      ...(operation === "delete" ? {} : { progress: 0 }),
    });
    this.emit();
    void (operation === "delete" ? this.remove(font.id) : this.install(font))
      .catch((error) => {
        this.failures.set(font.id, this.error(error));
      })
      .finally(() => {
        this.jobs.delete(font.id);
        this.emit();
      });
  }
  private async refreshCatalog(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    this.notice = undefined;
    this.emit();
    try {
      const response = await this.fetch(CATALOG_URL, 20000);
      const bytes = await readBytes(response, 512 * 1024);
      const next = parseCatalog(JSON.parse(new TextDecoder().decode(bytes)));
      this.assertCurrent();
      if (next.revision < this.catalog.revision)
        throw new Error(
          "Font catalog revision is older than the cached catalog.",
        );
      this.catalog = next;
      const checkedAt = Date.now();
      this.storage.updateStore((state) => ({
        ...state,
        catalog: next,
        checkedAt,
      }));
      this.store.catalog = next;
      this.store.checkedAt = checkedAt;
    } catch {
      this.notice ??= this.context.translate(messages.cachedCatalog);
    } finally {
      this.refreshing = false;
      this.emit();
    }
  }
  private fetch(url: string, timeout = 180000): Promise<Response> {
    return this.context.host.window.fetch(url, {
      mode: "cors",
      credentials: "omit",
      cache: "no-cache",
      signal: AbortSignal.any([
        this.context.signal,
        AbortSignal.timeout(timeout),
      ]),
    });
  }
  private async prepare(
    font: FontEntry,
    bytes: Uint8Array[],
  ): Promise<LoadedFont> {
    const browser = this.context.host.window as unknown as {
      FontFace: typeof FontFace;
    };
    const family = `LoreloomFont_${font.id}_${font.revision}_${this.context.instanceId.replace(/[^a-zA-Z0-9]/g, "")}`;
    const faces = await Promise.all(
      font.files.map(async (file, index) => {
        const face = new browser.FontFace(family, bytes[index]!.buffer, {
          weight: file.weight,
          style: file.style,
          display: "swap",
        });
        return face.load();
      }),
    );
    this.assertCurrent();
    return {
      family: JSON.stringify(family),
      faces,
    };
  }
  private replace(font: FontEntry, loaded: LoadedFont): void {
    this.cache.put(font, loaded);
    this.loaded.set(font.id, loaded);
  }
  private async install(font: FontEntry): Promise<void> {
    const previous = this.store.installed[font.id];
    const uploaded: string[] = [];
    const files: InstalledFont["files"] = [];
    const buffers: Uint8Array[] = [];
    const total = font.files.reduce((sum, file) => sum + file.bytes, 0);
    let completed = 0;
    let saved = false;
    try {
      for (const file of font.files) {
        this.assertCurrent();
        const response = await this.fetch(file.url);
        const bytes = await readBytes(response, file.bytes, (received) => {
          const progress = (completed + received) / total;
          this.jobs.set(font.id, {
            label: this.context.translate(messages.downloading, {
              progress: Math.floor(progress * 100),
            }),
            progress,
          });
          this.emit(true);
        });
        this.phase(this.jobs, font.id, messages.verifying);
        await verifyFont(file, bytes, this.context.host.window.crypto);
        this.assertCurrent();
        buffers.push(bytes);
        completed += bytes.length;
      }
      this.phase(this.jobs, font.id, messages.parsing);
      const loaded = await this.prepare(font, buffers);
      for (const [index, file] of font.files.entries()) {
        this.assertCurrent();
        const filename = await this.storage.write(
          `loreloom-font-${font.id}-${file.id}-${file.sha256.slice(0, 16)}-${this.context.host.window.crypto.randomUUID().slice(0, 8)}.${file.format}`,
          buffers[index]!,
          (stage, progress) =>
            this.phase(
              this.jobs,
              font.id,
              stage === "uploading"
                ? progress === undefined
                  ? messages.uploadingPending
                  : messages.uploading
                : messages[stage],
              progress,
            ),
        );
        uploaded.push(filename);
        this.assertCurrent();
        this.phase(this.jobs, font.id, messages.readingBack, 0);
        const persisted = await readBytes(
          await this.storage.read(filename),
          file.bytes,
          (received) =>
            this.phase(
              this.jobs,
              font.id,
              messages.readingBack,
              received / file.bytes,
            ),
        );
        this.phase(this.jobs, font.id, messages.verifying);
        await verifyFont(file, persisted, this.context.host.window.crypto);
        files.push({ id: file.id, filename, sha256: file.sha256 });
      }
      this.assertCurrent();
      const entry: InstalledFont = {
        font,
        files,
        installedAt: new Date().toISOString(),
      };
      this.storage.updateStore((state) => ({
        ...state,
        installed: { ...state.installed, [font.id]: entry },
      }));
      saved = true;
      this.store.installed[font.id] = entry;
      this.ready.add(font.id);
      this.replace(font, loaded);
      // Old files remain usable until the replacement has been verified and recorded.
      for (const old of previous?.files ?? [])
        await this.removeUnused(old.filename).catch(() => {});
    } finally {
      if (!saved)
        for (const filename of uploaded)
          await this.removeUnused(filename).catch(() => {});
    }
  }
  private resetSelection(id: string): void {
    if (!this.current() || !this.settings) return;
    const snapshot = this.settings.read();
    if (snapshot.values.fontId === id)
      this.settings.update(
        { ...snapshot.values, fontId: "default" },
        snapshot.revision,
      );
  }
  private phase(
    target: Map<string, Job>,
    id: string,
    message: typeof messages.verifying,
    progress?: number,
  ): void {
    if (!this.current()) return;
    target.set(id, {
      label: this.context.translate(message, {
        progress: Math.floor((progress ?? 0) * 100),
      }),
      ...(progress !== undefined ? { progress } : {}),
    });
    this.emit(progress !== undefined && progress > 0 && progress < 1);
  }
  private async removeUnused(filename: string): Promise<void> {
    if (
      !Object.values(this.storage.readStore().installed).some((entry) =>
        entry.files.some((file) => file.filename === filename),
      )
    )
      await this.storage.remove(filename);
  }
  private async remove(id: string): Promise<void> {
    this.resetSelection(id);
    this.loaded.delete(id);
    this.cache.remove(id);
    this.ready.delete(id);
    const installed = this.store.installed[id];
    if (!installed) return;
    for (const file of installed.files) {
      this.assertCurrent();
      const otherReferences = Object.entries(
        this.storage.readStore().installed,
      ).some(
        ([key, entry]) =>
          key !== id &&
          entry.files.some((item) => item.filename === file.filename),
      );
      if (!otherReferences) await this.storage.remove(file.filename);
    }
    this.assertCurrent();
    this.storage.updateStore((state) => {
      delete state.installed[id];
      return state;
    });
    delete this.store.installed[id];
  }
  family(id: string): string | undefined {
    if (!this.current()) return;
    if (id === "default") {
      this.appliedId = "default";
      return;
    }
    const loaded = this.loaded.get(id);
    if (loaded) {
      this.appliedId = id;
      return loaded.family;
    }
    if (this.ready.has(id) && !this.loading.has(id)) {
      const installed = this.store.installed[id];
      this.phase(this.loading, id, messages.loading, 0);
      void this.load(id)
        .catch((error) => {
          if (this.store.installed[id] !== installed || !this.ready.has(id))
            return;
          this.ready.delete(id);
          this.failures.set(id, this.error(error));
          if (this.current() && this.settings) {
            const snapshot = this.settings.read();
            if (snapshot.values.fontId === id)
              this.settings.update(
                {
                  ...snapshot.values,
                  fontId: this.loaded.has(this.appliedId)
                    ? this.appliedId
                    : "default",
                },
                snapshot.revision,
              );
          }
        })
        .finally(() => {
          this.loading.delete(id);
          this.emit();
        });
    }
    // Keep the currently rendered face until the requested face is ready.
    return this.loaded.get(this.appliedId)?.family;
  }
  private async load(id: string): Promise<void> {
    const installed = this.store.installed[id];
    if (!installed) return;
    const buffers: Uint8Array[] = [];
    const total = installed.font.files.reduce(
      (sum, file) => sum + file.bytes,
      0,
    );
    let completed = 0;
    const phase = (message: typeof messages.verifying, progress?: number) => {
      if (this.store.installed[id] === installed && this.ready.has(id))
        this.phase(this.loading, id, message, progress);
    };
    for (const file of installed.font.files) {
      this.assertCurrent();
      phase(messages.loading, completed / total);
      const saved = installed.files.find((entry) => entry.id === file.id)!;
      const bytes = await readBytes(
        await this.storage.read(saved.filename),
        file.bytes,
        (received) => phase(messages.loading, (completed + received) / total),
      );
      phase(messages.verifying);
      await verifyFont(file, bytes, this.context.host.window.crypto);
      buffers.push(bytes);
      completed += bytes.length;
    }
    phase(messages.parsing);
    const loaded = await this.prepare(installed.font, buffers);
    // A deletion or replacement may have completed while the server was being read.
    if (this.store.installed[id] === installed && this.ready.has(id)) {
      phase(messages.applying);
      this.replace(installed.font, loaded);
    }
  }
}
