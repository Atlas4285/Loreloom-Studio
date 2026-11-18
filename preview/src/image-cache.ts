import type { HostedThemeAsset } from "../../shared/contracts/theme";

interface CachedImage {
  url: string;
  sha256: string;
  image: HTMLImageElement;
}

export class AssetImageCache {
  private readonly entries = new Map<string, CachedImage>();

  get(
    key: string,
    slot: string,
    asset: HostedThemeAsset,
    alt: string,
  ): HTMLImageElement {
    const existing = this.entries.get(key);
    if (existing?.url === asset.url && existing.sha256 === asset.sha256) {
      existing.image.alt = alt;
      return existing.image;
    }

    const image = new Image();
    image.width = asset.width;
    image.height = asset.height;
    image.alt = alt;
    // Start requests when the theme is selected, including offscreen images.
    image.loading = "eager";
    image.decoding = "async";
    image.dataset.hostedImage = slot;
    this.entries.set(key, { url: asset.url, sha256: asset.sha256, image });
    image.addEventListener(
      "error",
      () => {
        if (this.entries.get(key)?.image === image) this.entries.delete(key);
      },
      { once: true },
    );

    // Keep the same image element and request across theme and locale changes.
    image.src = asset.url;
    return image;
  }

  clear(): void {
    this.entries.clear();
  }
}
