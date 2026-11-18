import { message, type Message } from "../../../../../shared/i18n/message.ts";

export const MAX_COUNT = 1000;
export interface RandomInput {
  lower: number;
  upper: number;
  count: number;
  replacement: boolean;
}
export function parseInput(
  input: unknown,
  translate: (source: Message) => string = (source) => source.text,
): RandomInput {
  const fail = (source: Message): never => {
    throw new Error(translate(source));
  };
  if (!input || typeof input !== "object" || Array.isArray(input))
    return fail(
      message(
        "loreloom.randomInteger.errors.object",
        "Arguments must be an object.",
      ),
    );
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) => !["lower", "upper", "count", "replacement"].includes(key),
    )
  )
    return fail(
      message(
        "loreloom.randomInteger.errors.keys",
        "Unknown random integer argument.",
      ),
    );
  const { lower, upper } = value;
  const count = Object.hasOwn(value, "count") ? value.count : 1;
  const replacement = Object.hasOwn(value, "replacement")
    ? value.replacement
    : true;
  if (
    typeof lower !== "number" ||
    typeof upper !== "number" ||
    !Number.isSafeInteger(lower) ||
    !Number.isSafeInteger(upper)
  )
    return fail(
      message(
        "loreloom.randomInteger.errors.bounds",
        "Both bounds must be safe integers.",
      ),
    );
  if (lower > upper)
    return fail(
      message(
        "loreloom.randomInteger.errors.order",
        "The lower bound must not exceed the upper bound.",
      ),
    );
  if (
    typeof count !== "number" ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > MAX_COUNT
  )
    return fail(
      message(
        "loreloom.randomInteger.errors.count",
        "Count must be an integer from 1 to 1000.",
      ),
    );
  if (typeof replacement !== "boolean")
    return fail(
      message(
        "loreloom.randomInteger.errors.replacement",
        "Replacement must be a boolean.",
      ),
    );
  if (!replacement && BigInt(count) > BigInt(upper) - BigInt(lower) + 1n)
    return fail(
      message(
        "loreloom.randomInteger.errors.capacity",
        "Without replacement, count must not exceed the number of integers in the interval.",
      ),
    );
  return { lower, upper, count, replacement };
}

// Masked rejection sampling avoids modulo bias, including across zero and at
// safe-integer boundaries. BigInt keeps interval arithmetic exact.
function randomBelow(
  limit: bigint,
  source: Pick<Crypto, "getRandomValues">,
): bigint {
  if (limit === 1n) return 0n;
  const bits = (limit - 1n).toString(2).length;
  const mask = (1n << BigInt(bits)) - 1n;
  const words = new Uint32Array(2);
  while (true) {
    source.getRandomValues(words);
    const value = ((BigInt(words[0]) << 32n) | BigInt(words[1])) & mask;
    if (value < limit) return value;
  }
}

export function generateIntegers(
  input: unknown,
  source: Pick<Crypto, "getRandomValues"> = globalThis.crypto,
  translate?: (source: Message) => string,
): number[] {
  const { lower, upper, count, replacement } = parseInput(input, translate);
  const base = BigInt(lower);
  let remaining = BigInt(upper) - base + 1n;
  const result: number[] = [];
  // A sparse partial Fisher-Yates shuffle needs O(count) memory even when
  // the requested interval spans the entire safe-integer domain.
  const swaps = new Map<bigint, bigint>();
  for (let i = 0; i < count; i++) {
    const index = randomBelow(remaining, source);
    if (replacement) {
      result.push(Number(base + index));
    } else {
      const selected = swaps.get(index) ?? index;
      const last = remaining - 1n;
      if (index !== last) swaps.set(index, swaps.get(last) ?? last);
      swaps.delete(last);
      remaining--;
      result.push(Number(base + selected));
    }
  }
  return result;
}
