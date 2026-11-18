export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface ServiceDeclaration {
  service: string;
  protocol: number;
}
export interface ServiceUse extends ServiceDeclaration {
  required: boolean;
}
export interface ServiceProvider extends ServiceDeclaration {
  scriptId?: string;
  instanceId: string;
  target: "preset" | "character";
  generation: number;
}
export interface ServiceEnvelope {
  channel: "loreloom.services";
  version: 1;
  type: "discover" | "announce" | "withdraw" | "request" | "response";
  sender: string;
  generation: number;
  target?: string;
  targetGeneration?: number;
  service?: string;
  protocol?: number;
  requestId?: string;
  method?: string;
  payload?: JsonValue;
  error?: string;
  providers?: ServiceProvider[];
}
export function isJsonValue(
  value: unknown,
  seen = new Set<object>(),
): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  )
    return false;
  seen.add(value);
  const valid = Object.values(value).every((entry) => isJsonValue(entry, seen));
  seen.delete(value);
  return valid;
}
export function isServiceDeclaration(
  value: unknown,
): value is ServiceDeclaration {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.service === "string" &&
    /^[a-z][a-z0-9-]*$/.test(item.service) &&
    Number.isSafeInteger(item.protocol) &&
    Number(item.protocol) > 0
  );
}
export function parseEnvelope(value: unknown): ServiceEnvelope | null {
  if (
    !isJsonValue(value) ||
    !value ||
    Array.isArray(value) ||
    typeof value !== "object"
  )
    return null;
  const item = value as Record<string, unknown>;
  if (
    item.channel !== "loreloom.services" ||
    item.version !== 1 ||
    !["discover", "announce", "withdraw", "request", "response"].includes(
      String(item.type),
    ) ||
    typeof item.sender !== "string" ||
    !item.sender ||
    !Number.isSafeInteger(item.generation) ||
    Number(item.generation) < 0
  )
    return null;
  for (const key of ["target", "service", "requestId", "method", "error"]) {
    if (
      item[key] !== undefined &&
      (typeof item[key] !== "string" || !item[key])
    )
      return null;
  }
  if (
    item.protocol !== undefined &&
    (!Number.isSafeInteger(item.protocol) || Number(item.protocol) < 1)
  )
    return null;
  if (
    item.providers !== undefined &&
    (!Array.isArray(item.providers) ||
      !item.providers.every((provider: unknown) => {
        if (!isServiceDeclaration(provider)) return false;
        const entry = provider as unknown as Record<string, unknown>;
        return (
          (entry.scriptId === undefined ||
            (typeof entry.scriptId === "string" && !!entry.scriptId)) &&
          entry.instanceId === item.sender &&
          entry.generation === item.generation &&
          ["preset", "character"].includes(String(entry.target))
        );
      }))
  )
    return null;
  if (
    ["announce", "withdraw"].includes(String(item.type)) &&
    !Array.isArray(item.providers)
  )
    return null;
  if (
    ["request", "response"].includes(String(item.type)) &&
    (!item.target || !item.requestId || !item.service || !item.protocol)
  )
    return null;
  if (
    ["request", "response"].includes(String(item.type)) &&
    (!Number.isSafeInteger(item.targetGeneration) ||
      Number(item.targetGeneration) < 0)
  )
    return null;
  if (item.type === "request" && !item.method) return null;
  return item as unknown as ServiceEnvelope;
}
