import { fontSignature, type FontEntry } from "./catalog.ts";

export interface LoadedFont {
  family: string;
  faces: FontFace[];
}
interface CachedFont extends LoadedFont {
  signature: string;
}
const KEY = Symbol.for("loreloom.text-style.fonts.v1");
type FontDocument = Document & { [KEY]?: Map<string, CachedFont> };

// The host document outlives chat scopes and Tavern Helper script frames.
export class FontCache {
  private readonly entries: Map<string, CachedFont>;

  constructor(private readonly page: FontDocument) {
    this.entries = page[KEY] ??= new Map();
  }

  get(font: FontEntry): LoadedFont | undefined {
    const cached = this.entries.get(font.id);
    if (
      cached?.signature === fontSignature(font) &&
      cached.faces.every((face) => this.page.fonts.has(face))
    )
      return cached;
  }

  put(font: FontEntry, loaded: LoadedFont): void {
    this.remove(font.id);
    for (const face of loaded.faces) this.page.fonts.add(face);
    this.entries.set(font.id, {
      ...loaded,
      signature: fontSignature(font),
    });
  }

  remove(id: string): void {
    for (const face of this.entries.get(id)?.faces ?? [])
      this.page.fonts.delete(face);
    this.entries.delete(id);
  }
}
