import { parseExtraBody } from "../settings/index.ts";
import { record } from "../domain/usage.ts";
function merge(
  base: Record<string, unknown>,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    [...new Set([...Object.keys(base), ...Object.keys(extra)])].map((key) => {
      if (!Object.hasOwn(extra, key)) return [key, base[key]];
      const left = record(base[key]);
      const right = record(extra[key]);
      return [key, left && right ? merge(left, right) : extra[key]];
    }),
  );
}
export function prepareStreamingBody(
  body: Record<string, unknown>,
  getExtraBody: () => string,
  parseYaml: (text: string) => unknown,
): Record<string, unknown> {
  if (body.stream !== true || body.chat_completion_source !== "custom")
    return body;
  try {
    const extra = parseExtraBody(getExtraBody());
    if (!Object.keys(extra).length) return body;
    let included: Record<string, unknown> = {};
    if (
      typeof body.custom_include_body === "string" &&
      body.custom_include_body.trim()
    ) {
      const parsed = parseYaml(body.custom_include_body);
      if (Array.isArray(parsed))
        included = Object.assign({}, ...parsed.map(record).filter(Boolean));
      else {
        const value = record(parsed);
        if (!value) return body;
        included = value;
      }
    }
    return {
      ...body,
      custom_include_body: JSON.stringify(merge(included, extra)),
    };
  } catch {
    return body;
  }
}
