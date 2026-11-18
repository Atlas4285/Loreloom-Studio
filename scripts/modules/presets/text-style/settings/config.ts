export interface Config {
  enabled: boolean;
  userMessages: boolean;
  assistantMessages: boolean;
  reasoning: boolean;
  toolCalls: boolean;
  fontId: string;
  showFontShortcut: boolean;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  paragraphSpacing: number;
  padding: number;
  backgroundStrength: number;
}
export const DEFAULTS: Config = {
  enabled: true,
  userMessages: true,
  assistantMessages: true,
  reasoning: true,
  toolCalls: true,
  fontId: "default",
  showFontShortcut: true,
  fontSize: 16,
  fontWeight: 550,
  lineHeight: 1.8,
  paragraphSpacing: 0.85,
  padding: 12,
  backgroundStrength: 55,
};
export const LIMITS = {
  fontSize: { min: 12, max: 24, step: 1 },
  fontWeight: { min: 100, max: 900, step: 50 },
  lineHeight: { min: 1.4, max: 2.4, step: 0.1 },
  paragraphSpacing: { min: 0, max: 2, step: 0.05 },
  padding: { min: 4, max: 36, step: 1 },
  backgroundStrength: { min: 0, max: 100, step: 1 },
};
export function readConfig(
  values: import("../../../../../shared/contracts/settings.ts").SettingsValues,
): Config {
  return { ...DEFAULTS, ...values } as Config;
}
