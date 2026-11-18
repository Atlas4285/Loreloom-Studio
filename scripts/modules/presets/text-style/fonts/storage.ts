import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import {
  parseCatalog,
  record,
  type FontCatalog,
  type FontEntry,
} from "./catalog.ts";

export interface InstalledFont {
  font: FontEntry;
  files: { id: string; filename: string; sha256: string }[];
  installedAt: string;
}
export interface FontStore {
  schemaVersion: 1;
  catalog?: FontCatalog;
  checkedAt?: number;
  installed: Record<string, InstalledFont>;
}
interface HelperFiles {
  getVariables(option: { type: "global" }): Record<string, unknown>;
  updateVariablesWith(
    updater: (variables: Record<string, unknown>) => Record<string, unknown>,
    option: { type: "global" },
  ): unknown;
}
const KEY = "loreloom.fonts.v1";
export function fontFileReference(
  value: unknown,
): { filename: string; path: string } | undefined {
  if (typeof value !== "string") return;
  const match =
    /^(?:\/?(users?\/files)\/)?(loreloom-font-[a-zA-Z0-9_.-]+)$/.exec(value);
  if (!match || match[2]!.length > 240) return;
  return {
    filename: match[2]!,
    path: `${match[1] ?? "user/files"}/${match[2]}`,
  };
}
export const isManagedFile = (name: unknown): name is string =>
  !!fontFileReference(name);
export function parseStore(value: unknown): FontStore {
  const result: FontStore = { schemaVersion: 1, installed: {} };
  if (!record(value) || value.schemaVersion !== 1) return result;
  try {
    if (value.catalog) result.catalog = parseCatalog(value.catalog);
  } catch {
    /* Retain usable installed fonts. */
  }
  if (typeof value.checkedAt === "number" && Number.isFinite(value.checkedAt))
    result.checkedAt = value.checkedAt;
  if (record(value.installed))
    for (const [id, entry] of Object.entries(value.installed)) {
      try {
        if (
          !record(entry) ||
          !Array.isArray(entry.files) ||
          typeof entry.installedAt !== "string"
        )
          continue;
        const font = parseCatalog({
          schemaVersion: 1,
          revision: 1,
          updatedAt: entry.installedAt,
          fonts: [entry.font],
        }).fonts[0]!;
        if (
          font.id !== id ||
          entry.files.length !== font.files.length ||
          !entry.files.every(
            (file) =>
              record(file) &&
              isManagedFile(file.filename) &&
              font.files.some(
                (source) =>
                  source.id === file.id && source.sha256 === file.sha256,
              ),
          )
        )
          continue;
        if (
          new Set(entry.files.map((file) => file.id)).size !==
          entry.files.length
        )
          continue;
        result.installed[id] = structuredClone(
          entry,
        ) as unknown as InstalledFont;
      } catch {
        /* A damaged record must not discard other fonts. */
      }
    }
  return result;
}
export class FontStorage {
  private readonly helper?: HelperFiles;
  constructor(private readonly context: ModuleContext) {
    const candidates = [context.host.window, globalThis.window];
    for (const candidate of candidates) {
      const helper = (
        candidate as unknown as { TavernHelper?: Partial<HelperFiles> }
      )?.TavernHelper;
      if (
        helper &&
        ["getVariables", "updateVariablesWith"].every(
          (key) => typeof helper[key as keyof HelperFiles] === "function",
        )
      ) {
        this.helper = helper as HelperFiles;
        break;
      }
    }
  }
  get available(): boolean {
    return !!this.helper && !!this.headers();
  }
  private api(): HelperFiles {
    if (!this.helper)
      throw new Error("Tavern Helper variables are unavailable.");
    return this.helper;
  }
  readStore(): FontStore {
    return parseStore(this.api().getVariables({ type: "global" })[KEY]);
  }
  updateStore(update: (state: FontStore) => FontStore): void {
    this.api().updateVariablesWith(
      (variables) => ({
        ...variables,
        [KEY]: update(parseStore(variables[KEY])),
      }),
      { type: "global" },
    );
  }
  async read(filename: string): Promise<Response> {
    const reference = fontFileReference(filename);
    if (!reference) throw new Error("Invalid font storage filename.");
    return this.context.host.window.fetch(`/${reference.path}`, {
      cache: "no-store",
      signal: AbortSignal.any([
        this.context.signal,
        AbortSignal.timeout(180000),
      ]),
    });
  }
  async write(
    filename: string,
    bytes: Uint8Array,
    notify: (
      stage: "preparing" | "uploading" | "saving",
      progress?: number,
    ) => void,
  ): Promise<string> {
    if (fontFileReference(filename)?.filename !== filename)
      throw new Error("Invalid font storage filename.");
    const headers = this.headers();
    if (!headers)
      throw new Error("SillyTavern request headers are unavailable.");
    notify("preparing");
    const parts: string[] = [];
    // Each independent Base64 chunk must contain a multiple of three bytes.
    // Yield between batches so large CJK fonts do not freeze the settings UI.
    const chunk = 49152;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      this.context.signal.throwIfAborted();
      parts.push(
        this.context.host.window.btoa(
          String.fromCharCode(...bytes.subarray(offset, offset + chunk)),
        ),
      );
      if ((offset / chunk) % 16 === 0)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const body = JSON.stringify({ name: filename, data: parts.join("") });
    this.context.signal.throwIfAborted();
    const browser = this.context.host.window as unknown as {
      XMLHttpRequest: typeof XMLHttpRequest;
    };
    const value: unknown = await new Promise((resolve, reject) => {
      const xhr = new browser.XMLHttpRequest();
      const signal = this.context.signal;
      const abort = () => xhr.abort();
      const finish = (error?: unknown, value?: unknown) => {
        signal.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve(value);
      };
      xhr.open("POST", "/api/files/upload");
      xhr.timeout = 180000;
      for (const [key, value] of Object.entries(headers))
        xhr.setRequestHeader(key, value);
      xhr.upload.onprogress = (event) =>
        notify(
          "uploading",
          event.lengthComputable && event.total > 0
            ? event.loaded / event.total
            : undefined,
        );
      // Sending all bytes does not mean that the server has saved the file.
      xhr.upload.onload = () => notify("saving");
      xhr.onload = () => {
        let result: unknown;
        try {
          result = JSON.parse(xhr.responseText);
        } catch {
          /* Invalid responses are rejected below. */
        }
        finish(
          xhr.status >= 200 && xhr.status < 300
            ? undefined
            : new Error(
                record(result) && typeof result.error === "string"
                  ? result.error
                  : `Font upload failed (${xhr.status}).`,
              ),
          result,
        );
      };
      xhr.onerror = () =>
        finish(new Error("Font upload failed. Check the server connection."));
      xhr.ontimeout = () => finish(new Error("Font upload timed out."));
      xhr.onabort = () =>
        finish(signal.reason ?? new Error("Font upload was cancelled."));
      signal.addEventListener("abort", abort, { once: true });
      try {
        signal.throwIfAborted();
        notify("uploading", 0);
        xhr.send(body);
      } catch (error) {
        finish(error);
      }
    });
    const reference = record(value) ? fontFileReference(value.path) : undefined;
    if (!reference)
      throw new Error("The server returned an unexpected font filename.");
    return reference.path;
  }
  private headers(): Record<string, string> | undefined {
    const tavern = (
      this.context.host.window as unknown as {
        SillyTavern?: {
          getContext(): { getRequestHeaders?: () => Record<string, string> };
        };
      }
    ).SillyTavern?.getContext();
    return tavern?.getRequestHeaders?.();
  }
  async remove(filename: string): Promise<void> {
    const reference = fontFileReference(filename);
    const headers = this.headers();
    if (!reference || !headers)
      throw new Error("Font deletion is unavailable.");
    const response = await this.context.host.window.fetch("/api/files/delete", {
      method: "POST",
      headers,
      body: JSON.stringify({ path: reference.path }),
    });
    if (!response.ok && response.status !== 404)
      throw new Error(`Could not delete font file (${response.status}).`);
  }
}
