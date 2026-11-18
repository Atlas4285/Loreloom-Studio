export interface Message {
  readonly key: string;
  readonly text: string;
}

export function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.key === "string" &&
    candidate.key.startsWith("loreloom.") &&
    typeof candidate.text === "string" &&
    candidate.text.trim().length > 0
  );
}

export function message(key: string, text: string): Message {
  const source = { key, text };
  if (!isMessage(source)) throw new Error(`Invalid source message: ${key}`);
  return source;
}

export function translateMessage(
  source: Message,
  dictionary: Readonly<Record<string, string>> = {},
  values: Readonly<Record<string, string | number>> = {},
): string {
  const text = dictionary[source.key]?.trim()
    ? dictionary[source.key]
    : source.text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}
