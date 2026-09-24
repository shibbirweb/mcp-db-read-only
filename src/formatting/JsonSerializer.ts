/**
 * Turns driver output into JSON a person and a model can read.
 *
 * Plain `JSON.stringify` fails in three ways across these drivers:
 *
 * - It throws on a `bigint`, which SQLite, ClickHouse and MongoDB can return.
 * - It renders a Buffer as `{"type":"Buffer","data":[1,2,3,...]}`, one number
 *   per byte, which floods the context window with a binary column.
 * - It renders a Map (Redis replies, some driver metadata) as `{}`.
 *
 * A single serializer used by every tool means a new driver cannot forget one
 * of these.
 */
export class JsonSerializer {
  /** Enough bytes to recognise a value; the length says how much was omitted. */
  private static readonly BINARY_PREVIEW_BYTES = 32;

  public stringify(value: unknown): string {
    const serializer = this;
    return JSON.stringify(
      value,
      // A function rather than an arrow, because the replacer receives the
      // value after toJSON has already run, and only `this[key]` still holds
      // the original Buffer.
      function (this: Record<string, unknown>, key: string, replaced: unknown): unknown {
        return serializer.replace(this[key], replaced);
      },
      2
    ) ?? "null";
  }

  private replace(original: unknown, replaced: unknown): unknown {
    if (typeof original === "bigint") {
      // Exact where a number can be, a string where it cannot, so no digit
      // is ever silently rounded away.
      return Number.isSafeInteger(Number(original)) ? Number(original) : original.toString();
    }
    if (original instanceof Uint8Array) {
      return this.describeBinary(original);
    }
    if (original instanceof Map) {
      return Object.fromEntries(original);
    }
    if (original instanceof Set) {
      return Array.from(original);
    }
    return replaced;
  }

  private describeBinary(bytes: Uint8Array): string {
    const shown = Buffer.from(bytes.subarray(0, JsonSerializer.BINARY_PREVIEW_BYTES)).toString("hex");
    const more = bytes.length > JsonSerializer.BINARY_PREVIEW_BYTES ? "..." : "";
    return `<binary ${bytes.length} bytes: 0x${shown}${more}>`;
  }
}
