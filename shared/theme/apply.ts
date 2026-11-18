export function applyTheme(root: HTMLElement, themeId: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(themeId)) {
    throw new Error(`Invalid theme ID: ${themeId}`);
  }
  root.setAttribute("data-loreloom-root", "");
  root.dataset.theme = themeId;
}
