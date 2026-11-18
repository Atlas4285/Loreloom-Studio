import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import type { Config } from "../settings/config.ts";
import { hasMessageContent } from "./content.ts";
import { createBackgrounds, type Backgrounds } from "./background.ts";
import { alignToolCalls } from "./tool-layout.ts";
import messageCss from "./styles/messages.css?raw";
import extrasCss from "./styles/extras.css?raw";
interface Mounted {
  nodes: Set<HTMLElement>;
  unmount: () => void;
  properties: Map<string, { value: string; priority: string }>;
}
const variables = [
  "--text-style-font-family",
  "--text-style-strength",
  "--text-style-padding",
  "--text-style-font-size",
  "--text-style-font-weight",
  "--text-style-line-height",
  "--text-style-compact-line-height",
  "--text-style-compact-paragraph-spacing",
  "--text-style-paragraph-spacing",
  "--text-style-opacity",
  "--text-style-shadow-opacity",
  "--text-style-reasoning-size",
  "--text-style-tool-size",
  "--text-style-body-width",
  "--text-style-body-offset",
];
export class TextRenderer {
  private readonly texts = new Map<HTMLElement, Mounted>();
  private readonly extras = new Map<HTMLElement, Mounted>();
  private readonly style: HTMLStyleElement;
  private readonly backgrounds: Backgrounds;
  private readonly scope: string;
  constructor(
    private readonly context: ModuleContext,
    private readonly isActive: () => boolean,
    private readonly generating: (id: number) => boolean,
    refresh: () => void,
  ) {
    this.scope = JSON.stringify(context.scope);
    this.style = context.host.document.createElement("style");
    this.style.textContent = messageCss + "\n" + extrasCss;
    context.host.document.head.append(this.style);
    this.backgrounds = createBackgrounds(context, refresh);
    context.lifecycle.defer(() => {
      this.clear();
      this.style.remove();
    });
  }
  private current(): boolean {
    if (!this.isActive() || this.context.signal.aborted) return false;
    try {
      return JSON.stringify(this.context.host.scope()) === this.scope;
    } catch {
      return false;
    }
  }
  private mount(
    element: HTMLElement,
    records: Map<HTMLElement, Mounted>,
  ): void {
    if (records.has(element)) return;
    const properties = new Map(
      variables.map((key) => [
        key,
        {
          value: element.style.getPropertyValue(key),
          priority: element.style.getPropertyPriority(key),
        },
      ]),
    );
    records.set(element, {
      nodes: new Set(),
      unmount: this.context.theme.mount(element),
      properties,
    });
  }
  private release(
    element: HTMLElement,
    records: Map<HTMLElement, Mounted>,
  ): void {
    const mounted = records.get(element);
    if (!mounted) return;
    // Also remove decorations moved into another renderer's saved fragment.
    for (const node of mounted.nodes) node.remove();
    if (records === this.texts) {
      element
        .querySelectorAll(":scope > .loreloom-text-style__background")
        .forEach((node) => node.remove());
      element.classList.remove(
        "loreloom-text-style",
        "loreloom-text-style--user",
        "loreloom-text-style--assistant",
      );
      element.removeAttribute("data-loreloom-text-owner");
      element.removeAttribute("data-loreloom-text-streaming");
    } else {
      element
        .querySelectorAll(".loreloom-text-style__extra-icon")
        .forEach((node) => node.remove());
      element.classList.remove(
        "loreloom-text-style-reasoning",
        "loreloom-text-style-tools",
      );
      element.removeAttribute("data-loreloom-text-extras");
    }
    for (const [key, previous] of mounted.properties) {
      if (previous.value)
        element.style.setProperty(key, previous.value, previous.priority);
      else element.style.removeProperty(key);
    }
    mounted.unmount();
    records.delete(element);
  }
  private config(
    element: HTMLElement,
    config: Config,
    fontFamily?: string,
  ): void {
    const values = {
      "--text-style-font-family": `${fontFamily ? `${fontFamily}, ` : ""}"Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`,
      "--text-style-strength": `${config.backgroundStrength}%`,
      "--text-style-padding": `${config.padding}px`,
      "--text-style-font-size": `${config.fontSize}px`,
      "--text-style-font-weight": String(config.fontWeight),
      "--text-style-line-height": String(config.lineHeight),
      "--text-style-compact-line-height": String(
        Math.max(1.1, config.lineHeight * 0.7),
      ),
      "--text-style-compact-paragraph-spacing": `${config.paragraphSpacing * 0.5}em`,
      "--text-style-paragraph-spacing": `${config.paragraphSpacing}em`,
      "--text-style-opacity": String(config.backgroundStrength / 100),
      "--text-style-shadow-opacity": `${config.backgroundStrength / 5}%`,
      "--text-style-reasoning-size": `${Math.max(12, config.fontSize - 1)}px`,
      "--text-style-tool-size": `${Math.max(12, config.fontSize - 2)}px`,
    };
    for (const [key, value] of Object.entries(values))
      if (element.style.getPropertyValue(key) !== value)
        element.style.setProperty(key, value);
  }
  private icon(
    message: HTMLElement,
    selector: string,
    enabled: boolean,
    slot: string,
  ): void {
    const mounted = this.extras.get(message);
    for (const node of mounted?.nodes ?? [])
      if (!message.contains(node)) {
        node.remove();
        mounted?.nodes.delete(node);
      }
    for (const header of message.querySelectorAll<HTMLElement>(selector)) {
      const existing = header.querySelector<HTMLImageElement>(
        ":scope > .loreloom-text-style__extra-icon",
      );
      if (!enabled) {
        existing?.remove();
        if (existing) mounted?.nodes.delete(existing);
        continue;
      }
      const icon =
        existing ??
        this.backgrounds.image(slot, "loreloom-text-style__extra-icon");
      mounted?.nodes.add(icon);
      this.backgrounds.updateImage(icon, slot);
      if (!existing) header.prepend(icon);
    }
  }
  render(config: Config, fontFamily?: string): void {
    if (!this.current() || !config.enabled) {
      this.clear();
      return;
    }
    const page = this.context.host.document;
    const messages = this.context.host.messages();
    const seenTexts = new Set<HTMLElement>();
    const seenExtras = new Set<HTMLElement>();
    for (const message of page.querySelectorAll<HTMLElement>(
      "#chat .mes[mesid]",
    )) {
      const id = Number(message.getAttribute("mesid"));
      const stored = messages[id];
      if (!Number.isSafeInteger(id) || id < 0 || !stored) continue;
      const text = message.querySelector<HTMLElement>(".mes_text");
      const user = !!stored.is_user;
      const reasoning =
        config.reasoning && !!message.querySelector(".mes_reasoning_details");
      const tools =
        config.toolCalls &&
        message.classList.contains("toolCall") &&
        !!message.querySelector(".mes_text > details");
      if (reasoning || tools) {
        seenExtras.add(message);
        this.mount(message, this.extras);
        message.dataset.loreloomTextExtras = this.context.instanceId;
        this.config(message, config, fontFamily);
        message.classList.toggle("loreloom-text-style-reasoning", reasoning);
        message.classList.toggle("loreloom-text-style-tools", tools);
        this.icon(
          message,
          ".mes_reasoning_header",
          reasoning,
          "reasoning-marker",
        );
        this.icon(
          message,
          ".mes_text > details > summary",
          tools,
          "tool-call-marker",
        );
        if (!tools) {
          message.style.removeProperty("--text-style-body-width");
          message.style.removeProperty("--text-style-body-offset");
        }
      }
      if (
        text &&
        !stored.is_system &&
        !tools &&
        (user ? config.userMessages : config.assistantMessages) &&
        hasMessageContent(text)
      ) {
        seenTexts.add(text);
        this.mount(text, this.texts);
        text.dataset.loreloomTextOwner = this.context.instanceId;
        this.config(text, config, fontFamily);
        text.classList.add("loreloom-text-style");
        text.classList.toggle("loreloom-text-style--user", user);
        text.classList.toggle("loreloom-text-style--assistant", !user);
        if (!user) {
          const value = String(
            id === messages.length - 1 && this.generating(id),
          );
          if (text.dataset.loreloomTextStreaming !== value)
            text.dataset.loreloomTextStreaming = value;
        } else text.removeAttribute("data-loreloom-text-streaming");
        const background = this.backgrounds.background(text, user);
        this.texts.get(text)?.nodes.add(background);
      }
    }
    for (const element of this.texts.keys())
      if (!seenTexts.has(element)) this.release(element, this.texts);
    for (const element of this.extras.keys())
      if (!seenExtras.has(element)) this.release(element, this.extras);
    alignToolCalls(page, this.context.instanceId);
  }
  clear(): void {
    for (const element of this.texts.keys()) this.release(element, this.texts);
    for (const element of this.extras.keys())
      this.release(element, this.extras);
  }
}
