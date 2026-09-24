/** One field path seen while sampling a collection. */
export interface SampledField {
  readonly path: string;
  readonly types: string[];
  /** Share of sampled documents containing this path, 0 to 100. */
  readonly presentPercent: number;
}

/**
 * Infers a collection's shape from a sample of its documents.
 *
 * MongoDB has no schema to read, so describe_table answers the question
 * people actually ask of a table description ("what fields are there, and of
 * what type") by looking at documents. The presence percentage matters as much
 * as the types: a field present in 3% of documents is a very different thing
 * to query on than one present in all of them.
 */
export class MongoSchemaSampler {
  /** Deep enough for real documents without turning one describe into a dump. */
  private static readonly MAX_DEPTH = 4;

  public infer(documents: readonly Record<string, unknown>[]): SampledField[] {
    const types = new Map<string, Set<string>>();
    const counts = new Map<string, number>();

    for (const document of documents) {
      const seen = new Set<string>();
      this.walk(document, "", 0, types, seen);
      for (const path of seen) {
        counts.set(path, (counts.get(path) ?? 0) + 1);
      }
    }

    const total = Math.max(documents.length, 1);
    return Array.from(types.entries())
      .map(([path, found]) => ({
        path,
        types: Array.from(found).sort(),
        presentPercent: Math.round(((counts.get(path) ?? 0) / total) * 100),
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  private walk(
    value: Record<string, unknown>,
    prefix: string,
    depth: number,
    types: Map<string, Set<string>>,
    seen: Set<string>
  ): void {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      seen.add(path);
      const found = types.get(path) ?? new Set<string>();
      found.add(this.typeOf(child));
      types.set(path, found);

      if (this.isPlainObject(child) && depth < MongoSchemaSampler.MAX_DEPTH) {
        this.walk(child, path, depth + 1, types, seen);
      }
    }
  }

  /**
   * BSON types by their driver class name (ObjectId, Decimal128, Long), which
   * is what a reader needs to write a correct filter against the field.
   */
  private typeOf(value: unknown): string {
    if (value === null) {
      return "null";
    }
    if (Array.isArray(value)) {
      return "array";
    }
    if (value instanceof Date) {
      return "date";
    }
    if (typeof value === "object") {
      const bsonType = (value as { _bsontype?: unknown })._bsontype;
      if (typeof bsonType === "string") {
        return bsonType;
      }
      return "object";
    }
    return typeof value;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      typeof (value as { _bsontype?: unknown })._bsontype !== "string"
    );
  }
}
