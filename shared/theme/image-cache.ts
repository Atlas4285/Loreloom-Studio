import type { HostedThemeAsset } from "../contracts/theme.ts";

interface CacheEntry {
  promise: Promise<string>;
  image: HTMLImageElement;
  objectUrl?: string;
  failedAt?: number;
}

export class HostedImageCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly controller = new AbortController();
  private readonly browser: Window & typeof globalThis;

  constructor(window: Window) {
    this.browser = window as Window & typeof globalThis;
  }

  get(asset: HostedThemeAsset): Promise<string> {
    this.controller.signal.throwIfAborted();
    const key = `${asset.url}\n${asset.sha256}`;
    const existing = this.entries.get(key);
    if (
      existing &&
      (existing.failedAt === undefined ||
        Date.now() - existing.failedAt < 30000)
    )
      return existing.promise;
    if (existing) this.release(existing);
    const image = this.browser.document.createElement("img");
    image.decoding = "async";
    image.loading = "eager";
    const entry: CacheEntry = { image, promise: Promise.resolve(asset.url) };
    this.entries.set(key, entry);
    entry.promise = this.load(asset, entry);
    return entry.promise;
  }

  private waitForImage(entry: CacheEntry, url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const signal = this.controller.signal;
      const cleanup = () => {
        entry.image.removeEventListener("load", loaded);
        entry.image.removeEventListener("error", failed);
        signal.removeEventListener("abort", aborted);
      };
      const loaded = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error("Image could not be decoded."));
      };
      const aborted = () => {
        cleanup();
        reject(signal.reason);
      };
      entry.image.addEventListener("load", loaded, { once: true });
      entry.image.addEventListener("error", failed, { once: true });
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) {
        aborted();
        return;
      }
      entry.image.src = url;
    });
  }

  private async load(
    asset: HostedThemeAsset,
    entry: CacheEntry,
  ): Promise<string> {
    try {
      const response = await this.browser.fetch(asset.url, {
        mode: "cors",
        credentials: "omit",
        cache: "force-cache",
        signal: AbortSignal.any([
          this.controller.signal,
          AbortSignal.timeout(15000),
        ]),
      });
      if (!response.ok)
        throw new Error(`Image request failed: ${response.status}`);
      const blob = await response.blob();
      this.controller.signal.throwIfAborted();
      if (!blob.size) throw new Error("Image response is empty.");
      entry.objectUrl = this.browser.URL.createObjectURL(blob);
      await this.waitForImage(entry, entry.objectUrl);
      return entry.objectUrl;
    } catch (error) {
      if (entry.objectUrl) {
        this.browser.URL.revokeObjectURL(entry.objectUrl);
        entry.objectUrl = undefined;
      }
      if (this.controller.signal.aborted) throw error;
      // Cross-origin image display does not require permission to read its bytes.
      entry.image.addEventListener(
        "error",
        () => {
          entry.failedAt = Date.now();
        },
        { once: true },
      );
      entry.image.src = asset.url;
      return asset.url;
    }
  }

  private release(entry: CacheEntry): void {
    entry.image.removeAttribute("src");
    if (entry.objectUrl) this.browser.URL.revokeObjectURL(entry.objectUrl);
  }

  clear(): void {
    this.controller.abort(new Error("Image cache has been disposed."));
    for (const entry of this.entries.values()) this.release(entry);
    this.entries.clear();
  }
}
