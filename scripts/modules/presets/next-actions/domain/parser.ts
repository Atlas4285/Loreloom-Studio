const pattern = /<next_actions>\s*([\s\S]*?)\s*<\/next_actions>/i;
export interface ParsedNextActions {
  beforeText: string;
  actions: string[];
  afterText: string;
  hasBlock: boolean;
}
export function parseNextActions(text: string): ParsedNextActions {
  const match = pattern.exec(text);
  if (!match)
    return { beforeText: text, actions: [], afterText: "", hasBlock: false };
  return {
    beforeText: text.slice(0, match.index),
    actions: match[1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    afterText: text.slice(match.index + match[0].length),
    hasBlock: true,
  };
}
