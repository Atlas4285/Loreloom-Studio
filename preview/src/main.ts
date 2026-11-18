import { localizedName } from "../../shared/contracts/names";
import "../../themes/base.css";
import "./styles.css";
import studio from "../../studio.config";
import { applyTheme } from "../../shared/theme/apply";
import { contract, themes } from "./catalog";
import { translate, type Locale } from "./i18n";
import { message, type Message } from "../../shared/i18n/message";
import { bindDropdowns, type DropdownKind } from "./dropdown";
import { AssetImageCache } from "./image-cache";
import type { HostedThemeAsset } from "../../shared/contracts/theme";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Preview root is missing.");
const app = root;
const imageCache = new AssetImageCache();
const preferenceKey = "loreloom.theme-preview";
const state = {
  themeId: studio.themes.defaultId as string,
  locale: studio.i18n.previewLocale as Locale,
  group: "all",
  name: "",
  detail: 60,
  hints: true,
};

try {
  const saved: unknown = JSON.parse(
    localStorage.getItem(preferenceKey) ?? "{}",
  );
  if (saved && typeof saved === "object") {
    const preferences = saved as Record<string, unknown>;
    if (themes.some((theme) => theme.manifest.id === preferences.themeId)) {
      state.themeId = String(preferences.themeId);
    }
    if (
      preferences.previewDefaultLocale === studio.i18n.previewLocale &&
      (preferences.locale === "en" || preferences.locale === "zh-CN")
    ) {
      state.locale = preferences.locale;
    }
  }
} catch {
  // Preview preferences are optional when browser storage is unavailable.
}

const paletteStyle = document.createElement("style");
paletteStyle.dataset.loreloomPalettes = "";
paletteStyle.textContent = themes.map((theme) => theme.palette).join("\n");
document.head.append(paletteStyle);

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
const t = (source: Message, values?: Record<string, string | number>): string =>
  escapeHtml(translate(state.locale, source, values));
const label = (source: Message): string => t(source);
const currentTheme = () =>
  themes.find((theme) => theme.manifest.id === state.themeId) ?? themes[0];
const tokenCount = contract.groups.reduce(
  (count, group) => count + group.tokens.length,
  0,
);

const icon = (
  name:
    | "grid"
    | "palette"
    | "sliders"
    | "spark"
    | "arrow"
    | "copy"
    | "globe"
    | "image"
    | "link"
    | "prompt",
): string => {
  const paths = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    palette:
      '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="9" r="1"/><circle cx="14" cy="7" r="1"/><circle cx="17" cy="12" r="1"/><path d="M6 17c4-3 6 4 9 1"/>',
    sliders:
      '<path d="M5 3v6m0 4v8M12 3v10m0 4v4M19 3v 2m0 4v12M2 9h6m1 8h6m1-12h6"/>',
    spark:
      '<path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3Z"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
    globe:
      '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-4 4-4 14 0 18M12 3c4 4 4 14 0 18"/>',
    image:
      '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
    link: '<path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4m11 1 1-1a4 4 0 0 1 6 6l-4 4"/>',
    prompt: '<path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8M8 16h6"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
};

interface PreviewOption {
  value: string;
  text: string;
  decoration: string;
}

function dropdown(
  kind: DropdownKind,
  selectedValue: string,
  items: PreviewOption[],
): string {
  const id = `${kind}-select`;
  const selected =
    items.find((item) => item.value === selectedValue) ?? items[0];
  const name =
    kind === "theme"
      ? message("loreloom.controls.theme", "Theme")
      : message("loreloom.controls.language", "Language");
  return `<div class="dropdown" data-dropdown="${kind}" data-open="false">
    <button type="button" id="${id}" class="dropdown-trigger" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-options" aria-label="${t(name)}: ${escapeHtml(selected.text)}"><span class="select-icon">${icon(kind === "theme" ? "palette" : "globe")}</span><span class="dropdown-value">${escapeHtml(selected.text)}</span><span class="dropdown-chevron" aria-hidden="true"></span></button>
    <div id="${id}-options" class="dropdown-menu" role="listbox" aria-label="${t(name)}" hidden>${items.map((item, index) => `<button type="button" id="${id}-option-${index}" class="dropdown-option" role="option" tabindex="-1" aria-selected="${item.value === selectedValue}" data-dropdown-value="${item.value}" data-label="${escapeHtml(item.text)}">${item.decoration}<span class="dropdown-option-copy">${escapeHtml(item.text)}</span><span class="dropdown-check" aria-hidden="true">✓</span></button>`).join("")}</div>
  </div>`;
}

const assetNames: Record<string, Message> = {
  "text-style.assistant-top": message(
    "loreloom.assets.names.text-style.assistant-top",
    "Assistant header",
  ),
  "text-style.assistant-texture": message(
    "loreloom.assets.names.text-style.assistant-texture",
    "Assistant texture",
  ),
  "text-style.assistant-bottom": message(
    "loreloom.assets.names.text-style.assistant-bottom",
    "Assistant footer",
  ),
  "text-style.user": message(
    "loreloom.assets.names.text-style.user",
    "User message",
  ),
  "next-actions.panel": message(
    "loreloom.assets.names.next-actions.panel",
    "Next actions panel",
  ),
  "studio-settings.dialog": message(
    "loreloom.assets.names.studio-settings.dialog",
    "Settings dialog",
  ),
  "state-trace.panel": message(
    "loreloom.assets.names.state-trace.panel",
    "State trace panel",
  ),
  "text-style.tool-call-marker": message(
    "loreloom.assets.names.text-style.tool-call-marker",
    "Tool call marker",
  ),
  "text-style.reasoning-marker": message(
    "loreloom.assets.names.text-style.reasoning-marker",
    "Reasoning marker",
  ),
  "next-actions.list-marker": message(
    "loreloom.assets.names.next-actions.list-marker",
    "Action list marker",
  ),
  "studio-settings.settings-button": message(
    "loreloom.assets.names.studio-settings.settings-button",
    "Settings button",
  ),
  "studio-settings.dialog-title": message(
    "loreloom.assets.names.studio-settings.dialog-title",
    "Settings title",
  ),
};

const projectNames: Record<string, Message> = {
  "next-actions": message(
    "loreloom.assets.projects.next-actions",
    "Next Actions",
  ),
  "studio-settings": message(
    "loreloom.assets.projects.studio-settings",
    "Studio Settings",
  ),
  "text-style": message("loreloom.assets.projects.text-style", "Text Style"),
  "state-trace": message("loreloom.assets.projects.state-trace", "State Trace"),
};

const effectNames: Record<string, Message> = {
  main: message("loreloom.effects.main", "Primary gradient"),
  accent: message("loreloom.effects.accent", "Accent gradient"),
  glass: message("loreloom.effects.glass", "Glass surface"),
  glow: message("loreloom.effects.glow", "Ambient glow"),
};

const categoryNames: Record<string, Message> = {
  icons: message("loreloom.assets.icons", "Icons"),
  backgrounds: message("loreloom.assets.backgrounds", "Backgrounds"),
};

const notifications: Record<string, Message> = {
  "palette.copied": message("loreloom.palette.copied", "Copied {token}"),
  "palette.copyFailed": message(
    "loreloom.palette.copyFailed",
    "Clipboard unavailable. Select the value to copy it manually.",
  ),
  "assets.linkCopied": message(
    "loreloom.assets.linkCopied",
    "Image link copied",
  ),
  "assets.promptCopied": message(
    "loreloom.assets.promptCopied",
    "Image prompt copied",
  ),
  "assets.copyFailed": message(
    "loreloom.assets.copyFailed",
    "Could not copy. Check clipboard permission and try again.",
  ),
};

const iconSlots = new Set([
  "text-style.tool-call-marker",
  "text-style.reasoning-marker",
  "next-actions.list-marker",
  "studio-settings.settings-button",
  "studio-settings.dialog-title",
]);

function assetCard(slot: string, asset: HostedThemeAsset): string {
  const isIcon = iconSlots.has(slot);
  const name = t(assetNames[slot]);
  const url = escapeHtml(asset.url);
  const fileName = escapeHtml(
    decodeURIComponent(new URL(asset.url).pathname.split("/").at(-1) ?? slot),
  );
  const size = new Intl.NumberFormat(state.locale, {
    maximumFractionDigits: 0,
  }).format(asset.bytes / 1024);
  return `<article class="asset-card ${isIcon ? "asset-card-icon" : "asset-card-background"}"><div class="asset-visual"><a class="asset-media" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="${t(message("loreloom.assets.open", "Open {name}"), { name: translate(state.locale, assetNames[slot]) })}"><span data-image-slot="${slot}"></span><span class="asset-fallback">${t(message("loreloom.assets.failed", "Image unavailable. Open the link to view it directly."))}</span></a><div class="asset-tools"><button type="button" data-asset-copy="link" data-asset-slot="${slot}" data-theme-id="${currentTheme().manifest.id}" aria-label="${t(message("loreloom.assets.copyLink", "Copy image link"))}" title="${t(message("loreloom.assets.copyLink", "Copy image link"))}">${icon("link")}</button><button type="button" data-asset-copy="prompt" data-asset-slot="${slot}" data-theme-id="${currentTheme().manifest.id}" aria-label="${t(message("loreloom.assets.copyPrompt", "Copy image prompt"))}" title="${t(message("loreloom.assets.copyPrompt", "Copy image prompt"))}">${icon("prompt")}</button></div></div><div class="asset-details"><h3>${name}</h3><code title="${fileName}">${fileName}</code><span>${asset.width} × ${asset.height}<span aria-hidden="true"> · </span>${size} KiB</span></div></article>`;
}

function assetGallery(): string {
  const assets = Object.entries(currentTheme().assets).sort(
    ([first], [second]) =>
      contract.assetSlots.indexOf(first) - contract.assetSlots.indexOf(second),
  );
  if (!assets.length) {
    return `<section id="assets" class="section asset-note"><span class="asset-icon">${icon("image")}</span><div><span class="eyebrow">04 / ${t(message("loreloom.assets.label", "Images"))}</span><h2>${t(message("loreloom.assets.empty", "No hosted images for this theme yet"))}</h2></div></section>`;
  }
  const categories = [
    { key: "icons", items: assets.filter(([slot]) => iconSlots.has(slot)) },
    {
      key: "backgrounds",
      items: assets.filter(([slot]) => !iconSlots.has(slot)),
    },
  ];
  const projects = [
    "next-actions",
    "studio-settings",
    "text-style",
    "state-trace",
  ];
  return `<section id="assets" class="section"><div class="section-heading"><div><span class="eyebrow">04 / ${t(message("loreloom.assets.label", "Images"))}</span><h2>${t(message("loreloom.assets.title", "Theme image library"))}</h2></div></div>${categories
    .filter((category) => category.items.length)
    .map(
      (category) =>
        `<div class="asset-group"><h3 class="asset-group-title">${t(categoryNames[category.key])}</h3>${projects
          .map((project) => {
            const items = category.items.filter(([slot]) =>
              slot.startsWith(`${project}.`),
            );
            if (!items.length) return "";
            return `<div class="asset-project"><h4>${t(projectNames[project])}</h4><div class="asset-grid asset-grid-${category.key}">${items.map(([slot, asset]) => assetCard(slot, asset)).join("")}</div></div>`;
          })
          .join("")}</div>`,
    )
    .join("")}</section>`;
}

function mountAssetImages(): void {
  const theme = currentTheme();
  app
    .querySelectorAll<HTMLElement>("[data-image-slot]")
    .forEach((placeholder) => {
      const slot = placeholder.dataset.imageSlot!;
      const asset = theme.assets[slot];
      if (!asset) return;
      const alt = translate(state.locale, assetNames[slot]);
      placeholder.replaceWith(
        imageCache.get(`${theme.manifest.id}:${slot}`, slot, asset, alt),
      );
    });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function notify(key: string, values?: Record<string, string | number>): void {
  const toast = app.querySelector<HTMLElement>("#status");
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.textContent = translate(state.locale, notifications[key], values);
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3000);
}

function persist(): void {
  try {
    localStorage.setItem(
      preferenceKey,
      JSON.stringify({
        themeId: state.themeId,
        locale: state.locale,
        previewDefaultLocale: studio.i18n.previewLocale,
      }),
    );
  } catch {
    // Storage restrictions do not prevent theme exploration.
  }
}

let navigationFrame = 0;

function updateNavigation(): void {
  navigationFrame = 0;
  const activationOffset =
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--preview-section-offset",
      ),
    ) || 0;
  const sectionIds = ["overview", "palette", "components", "effects", "assets"];
  let activeSection = sectionIds[0];
  for (const id of sectionIds) {
    const section = document.getElementById(id);
    if (
      section &&
      section.getBoundingClientRect().top <= activationOffset + 1
    ) {
      activeSection = id;
    }
  }
  if (
    window.scrollY > 0 &&
    Math.ceil(window.scrollY + window.innerHeight) >=
      document.documentElement.scrollHeight - 2
  ) {
    activeSection = sectionIds[sectionIds.length - 1];
  }
  app.querySelectorAll<HTMLAnchorElement>("nav a").forEach((link) => {
    const sectionId = link.hash === "#app" ? "overview" : link.hash.slice(1);
    if (sectionId === activeSection) {
      link.setAttribute("aria-current", "location");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

function scheduleNavigation(): void {
  if (!navigationFrame) {
    navigationFrame = window.requestAnimationFrame(updateNavigation);
  }
}

function renderPalette(): void {
  const container = app.querySelector<HTMLElement>("#tokens");
  if (!container) return;
  const groups = contract.groups.filter(
    (group) => state.group === "all" || state.group === group.id,
  );
  const visible = groups.flatMap((group) => {
    const tokens = group.tokens;
    if (tokens.length === 0) return [];
    return [
      `<div class="token-group"><h3>${label(group.label)}<span>${String(tokens.length).padStart(2, "0")}</span></h3><div class="token-grid">${tokens
        .map((token) => {
          const value = getComputedStyle(app).getPropertyValue(token).trim();
          const title = token.replace("--theme-", "").replaceAll("-", " ");
          return `<article class="token-card"><button class="swatch" data-copy="${token}" aria-label="${t(message("loreloom.palette.copy", "Copy {token}"), { token })}"><span class="copy-mark">${icon("copy")}</span></button><div class="token-details"><strong>${title}</strong><code>${token}</code><span class="token-value" title="${escapeHtml(value)}">${escapeHtml(value)}</span></div></article>`;
        })
        .join("")}</div></div>`,
    ];
  });
  container.innerHTML = visible.join("");
  container
    .querySelectorAll<HTMLButtonElement>("[data-copy]")
    .forEach((button) => {
      const token = button.dataset.copy!;
      button.style.background = `var(${token})`;
      if (token === "--theme-glow") {
        button.style.background = "var(--theme-surface-raised)";
        button.style.boxShadow =
          "inset 0 0 32px var(--theme-accent-primary-dark)";
      }
    });
  scheduleNavigation();
}

function render(): void {
  const { manifest } = currentTheme();
  applyTheme(app, manifest.id);
  document.documentElement.lang = state.locale;
  document.title = `Loreloom — ${translate(state.locale, message("loreloom.app.title", "Theme Studio"))}`;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      "content",
      getComputedStyle(app).getPropertyValue("--theme-background").trim(),
    );
  app.innerHTML = `
    <aside class="sidebar">
      <a class="brand" href="#app"><span>LORELOOM<small>${t(message("loreloom.app.workspace", "DESIGN WORKSPACE"))}</small></span></a>
      <div class="sidebar-rule"></div>
      <nav aria-label="${t(message("loreloom.app.title", "Theme Studio"))}">
        <a href="#app">${icon("grid")}${t(message("loreloom.nav.overview", "Overview"))}</a>
        <a href="#palette">${icon("palette")}${t(message("loreloom.nav.palette", "Color palette"))}</a>
        <a href="#components">${icon("sliders")}${t(message("loreloom.nav.components", "Components"))}</a>
        <a href="#effects">${icon("spark")}${t(message("loreloom.nav.effects", "Effects"))}</a>
        <a href="#assets">${icon("image")}${t(message("loreloom.assets.label", "Images"))}</a>
      </nav>
    </aside>
    <div class="workspace">
      <header class="topbar"><span class="breadcrumb">Loreloom <span>/</span> ${t(message("loreloom.app.title", "Theme Studio"))}</span><div class="toolbar">
        ${dropdown(
          "theme",
          state.themeId,
          themes.map(({ manifest: item }) => ({
            value: item.id,
            text: localizedName(item.name, state.locale),
            decoration: `<span class="dropdown-theme-mark" data-loreloom-root data-theme="${item.id}" aria-hidden="true"><i></i><i></i><i></i></span>`,
          })),
        )}
        ${dropdown("locale", state.locale, [
          {
            value: "zh-CN",
            text: translate(
              state.locale,
              message("loreloom.locale.zhCN", "Chinese"),
            ),
            decoration:
              '<span class="dropdown-language-mark" aria-hidden="true">CN</span>',
          },
          {
            value: "en",
            text: "English",
            decoration:
              '<span class="dropdown-language-mark" aria-hidden="true">EN</span>',
          },
        ])}
      </div></header>
      <main>
        <section id="overview" class="overview">
          <div class="section-intro"><span class="eyebrow">${t(message("loreloom.app.workspace", "DESIGN WORKSPACE"))}</span><h1>${t(message("loreloom.app.title", "Theme Studio"))}<span class="title-dot">.</span></h1></div>
          <div class="hero"><div class="hero-copy"><span class="eyebrow">${t(message("loreloom.hero.eyebrow", "THEME COLLECTION / {number}"), { number: String(manifest.order).padStart(2, "0") })}</span><h2>${escapeHtml(localizedName(manifest.name, state.locale))}</h2><p>${label(manifest.description)}</p><a class="button button-primary" href="#palette">${t(message("loreloom.hero.palette", "Explore the palette"))}${icon("arrow")}</a><div class="hero-stats"><span><i></i>${t(message("loreloom.hero.tokens", "{count} semantic tokens"), { count: tokenCount })}</span><span>${t(message("loreloom.hero.themes", "{count} coordinated themes"), { count: themes.length })}</span></div></div>
          <div class="hero-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="prism prism-back"></div><div class="prism prism-front"></div><div class="art-caption"><span>✦ ${t(message("loreloom.hero.live", "LIVE PREVIEW"))}</span><strong>${t(message("loreloom.hero.signature", "Color, in conversation."))}</strong><small>${t(message("loreloom.hero.signatureNote", "Designed to feel like one world."))}</small></div></div></div>
        </section>
        <section id="palette" class="section"><div class="section-heading"><div><span class="eyebrow">01 / ${t(message("loreloom.nav.palette", "Color palette"))}</span><h2>${t(message("loreloom.palette.title", "The color system"))}</h2></div></div><div class="filter-bar" role="group" aria-label="${t(message("loreloom.nav.palette", "Color palette"))}"><button data-group="all" aria-pressed="${state.group === "all"}">${t(message("loreloom.palette.all", "All tokens"))}<span>${tokenCount}</span></button>${contract.groups.map((group) => `<button data-group="${group.id}" aria-pressed="${state.group === group.id}">${label(group.label)}</button>`).join("")}</div><div id="tokens"></div></section>
        <section id="components" class="section"><div class="section-heading"><div><span class="eyebrow">02 / ${t(message("loreloom.nav.components", "Components"))}</span><h2>${t(message("loreloom.components.title", "A little interaction"))}</h2></div></div><div class="component-grid">
          <form id="sample-form" class="sample-panel"><div class="panel-title"><span class="panel-icon">${icon("sliders")}</span><div><h3>${t(message("loreloom.components.panel", "Story preferences"))}</h3></div></div><label class="field" for="sample-name"><span>${t(message("loreloom.components.name", "Display name"))}</span><input id="sample-name" placeholder="${t(message("loreloom.components.namePlaceholder", "Your storyteller"))}" value="${escapeHtml(state.name)}" /></label><label class="field" for="sample-detail"><span>${t(message("loreloom.components.density", "Detail level"))}<output id="detail-value">${state.detail}%</output></span><input id="sample-detail" type="range" min="0" max="100" value="${state.detail}" /></label><label class="toggle-row" for="sample-hints"><span><strong>${t(message("loreloom.components.notifications", "Show story hints"))}</strong><small>${t(message("loreloom.components.notificationsNote", "A gentle nudge when inspiration arrives."))}</small></span><input id="sample-hints" type="checkbox" role="switch" ${state.hints ? "checked" : ""} /></label><div class="panel-actions"><button class="button button-primary" type="submit">${t(message("loreloom.components.save", "Save preferences"))}</button><button class="button button-quiet" type="button" data-action="reset">${t(message("loreloom.components.reset", "Reset"))}</button></div></form>
          <article class="message-panel"><div class="message-label"><span class="assistant-avatar">✦</span><span>${t(message("loreloom.components.messageLabel", "ASSISTANT / MESSAGE PREVIEW"))}</span><span class="message-dots" aria-hidden="true">•••</span></div><h3>${t(message("loreloom.components.messageTitle", "A new chapter begins"))}</h3><p>${t(message("loreloom.components.messageBody", "The last light settles on the windowsill. Somewhere beyond the glass, a familiar voice calls your name."))}</p><blockquote>${t(message("loreloom.components.quote", "Every detail belongs to the same story."))}</blockquote><div class="story-actions"><button type="button">${t(message("loreloom.components.next", "Continue the story"))}${icon("arrow")}</button><button type="button">${t(message("loreloom.components.alternative", "Explore another path"))}${icon("arrow")}</button></div><div class="status-tags"><span class="tag success">● ${t(message("loreloom.components.success", "Ready to continue"))}</span><span class="tag danger">● ${t(message("loreloom.components.danger", "Connection interrupted"))}</span></div></article>
        </div></section>
        <section id="effects" class="section"><div class="section-heading"><div><span class="eyebrow">03 / ${t(message("loreloom.nav.effects", "Effects"))}</span><h2>${t(message("loreloom.effects.title", "Light, depth & atmosphere"))}</h2></div></div><div class="effects-grid">${["main", "accent", "glass", "glow"].map((effect) => `<article class="effect-card"><div class="effect-sample effect-${effect}">${effect === "glass" ? '<span class="glass-pane">Aa</span>' : effect === "glow" ? '<span class="glow-dot"></span>' : ""}</div><div><h3>${t(effectNames[effect])}</h3><code>--theme-${effect === "main" || effect === "accent" ? `gradient-${effect}` : effect}</code></div></article>`).join("")}</div></section>
        ${assetGallery()}
      </main>
    </div><div id="status" class="toast" role="status" aria-live="polite" hidden></div>`;
  mountAssetImages();
  renderPalette();
}

app.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLButtonElement>("button");
  if (!button) return;
  if (button.dataset.assetCopy) {
    const theme = themes.find(
      ({ manifest }) => manifest.id === button.dataset.themeId,
    );
    const slot = button.dataset.assetSlot ?? "";
    const text =
      button.dataset.assetCopy === "link"
        ? theme?.assets[slot]?.url
        : theme?.prompts[slot];
    if (!text || !navigator.clipboard) {
      notify("assets.copyFailed");
      return;
    }
    void navigator.clipboard.writeText(text).then(
      () =>
        notify(
          button.dataset.assetCopy === "link"
            ? "assets.linkCopied"
            : "assets.promptCopied",
        ),
      () => notify("assets.copyFailed"),
    );
    return;
  }
  if (button.dataset.group) {
    state.group = button.dataset.group;
    app
      .querySelectorAll<HTMLButtonElement>("[data-group]")
      .forEach((item) =>
        item.setAttribute("aria-pressed", String(item === button)),
      );
    renderPalette();
  } else if (button.dataset.copy) {
    const token = button.dataset.copy;
    const value = getComputedStyle(app).getPropertyValue(token).trim();
    if (!navigator.clipboard) {
      notify("palette.copyFailed");
      return;
    }
    void navigator.clipboard.writeText(value).then(
      () => notify("palette.copied", { token }),
      () => notify("palette.copyFailed"),
    );
  } else if (button.dataset.action === "reset") {
    state.name = "";
    state.detail = 60;
    state.hints = true;
    render();
  }
});

app.addEventListener("change", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.id === "sample-hints") {
    state.hints = target.checked;
  }
});

app.addEventListener("input", (event) => {
  if (!(event.target instanceof HTMLInputElement)) return;
  const target = event.target;
  if (target.id === "sample-name") state.name = target.value;
  if (target.id === "sample-detail") {
    state.detail = Number(target.value);
    const output = app.querySelector("#detail-value");
    if (output) output.textContent = `${state.detail}%`;
  }
});
app.addEventListener("submit", (event) => {
  event.preventDefault();
});

app.addEventListener(
  "error",
  (event) => {
    const image = event.target;
    if (
      image instanceof HTMLImageElement &&
      image.hasAttribute("data-hosted-image")
    ) {
      image
        .closest<HTMLElement>(".asset-card")
        ?.setAttribute("data-load-state", "failed");
    }
  },
  true,
);

const disposeDropdowns = bindDropdowns(app, (kind, value) => {
  if (
    kind === "theme" &&
    themes.some(({ manifest }) => manifest.id === value)
  ) {
    state.themeId = value;
  } else if (kind === "locale" && (value === "en" || value === "zh-CN")) {
    state.locale = value;
  } else {
    return;
  }
  persist();
  render();
});

window.addEventListener("scroll", scheduleNavigation, { passive: true });
window.addEventListener("resize", scheduleNavigation);
import.meta.hot?.dispose(() => {
  imageCache.clear();
  disposeDropdowns();
  window.removeEventListener("scroll", scheduleNavigation);
  window.removeEventListener("resize", scheduleNavigation);
  window.cancelAnimationFrame(navigationFrame);
  clearTimeout(toastTimer);
  paletteStyle.remove();
});

render();
