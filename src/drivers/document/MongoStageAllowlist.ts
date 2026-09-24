/**
 * The aggregation stages the MongoDB driver will send, and no others.
 *
 * Layer two for MongoDB, checked inside the driver immediately before
 * `aggregate` is called. MongoDB has no read-only session mode, so the server
 * cannot be asked to refuse a write; this list is the structural substitute.
 * It is an allowlist of stages, deliberately a different mechanism from the
 * tool-level MongoOperatorGuard (a denylist of operators), so the two do not
 * share a blind spot.
 *
 * Nested pipelines are walked too: `$facet` holds several, and `$lookup` and
 * `$unionWith` each hold one, any of which could otherwise carry a `$merge`.
 *
 * The honest limit of this layer: it constrains what this server sends. It is
 * not a server-side guarantee, which is why the README recommends connecting
 * with a user granted only the `read` role.
 */
export class MongoStageAllowlist {
  public static readonly STAGES = new Set([
    "$match",
    "$project",
    "$addFields",
    "$set",
    "$unset",
    "$group",
    "$sort",
    "$limit",
    "$skip",
    "$unwind",
    "$lookup",
    "$graphLookup",
    "$unionWith",
    "$facet",
    "$count",
    "$sortByCount",
    "$bucket",
    "$bucketAuto",
    "$replaceRoot",
    "$replaceWith",
    "$sample",
    "$redact",
    "$geoNear",
    "$setWindowFields",
    "$densify",
    "$fill",
    "$documents",
    "$collStats",
    "$indexStats",
    "$search",
    "$searchMeta",
    "$vectorSearch",
  ]);

  /** @throws Error naming the first stage that is not allowed. */
  public assertAllowed(pipeline: readonly unknown[]): void {
    for (const stage of pipeline) {
      if (!stage || typeof stage !== "object" || Array.isArray(stage)) {
        throw new Error("Every pipeline stage must be an object such as {\"$match\": {...}}.");
      }
      const keys = Object.keys(stage);
      if (keys.length !== 1) {
        throw new Error("Every pipeline stage must have exactly one stage operator.");
      }

      const name = keys[0];
      if (!MongoStageAllowlist.STAGES.has(name)) {
        throw new Error(`The aggregation stage ${name} is not allowed on a read-only connection.`);
      }
      this.assertNested(name, (stage as Record<string, unknown>)[name]);
    }
  }

  private assertNested(name: string, body: unknown): void {
    if (!body || typeof body !== "object") {
      return;
    }
    if (name === "$facet") {
      for (const nested of Object.values(body)) {
        this.assertAllowed(Array.isArray(nested) ? nested : [nested]);
      }
      return;
    }
    if (name === "$lookup" || name === "$unionWith") {
      const nested = (body as { pipeline?: unknown }).pipeline;
      if (nested !== undefined) {
        this.assertAllowed(Array.isArray(nested) ? nested : [nested]);
      }
    }
  }
}
