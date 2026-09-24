import type { ValidationResult } from "../../types/validation.types.js";

/**
 * Checks an Elasticsearch or OpenSearch `_search` body before it is sent.
 *
 * Layer one for search engines: an allowlist of top-level keys. The search
 * API cannot write whatever the body says, so this is not what keeps the data
 * safe. What it does is keep the request inside the plain search surface:
 * `scroll` and `pit` open server-side contexts that outlive the call, and an
 * unknown key is far more likely a mistake than a feature worth passing
 * through blind.
 *
 * Layer two is structural, in the driver: it can only send GET requests to a
 * fixed set of read endpoints and POST requests to `_search`, with paths it
 * builds itself from a validated index name. There is no generic request
 * method to misuse.
 */
export class SearchBodyValidator {
  public static readonly ALLOWED_KEYS = new Set([
    "query",
    "size",
    "from",
    "sort",
    "_source",
    "fields",
    "docvalue_fields",
    "stored_fields",
    "script_fields",
    "runtime_mappings",
    "aggs",
    "aggregations",
    "post_filter",
    "highlight",
    "collapse",
    "search_after",
    "track_total_hits",
    "min_score",
    "knn",
    "rescore",
    "suggest",
    "explain",
    "version",
    "seq_no_primary_term",
    "indices_boost",
    "timeout",
    "terminate_after",
  ]);

  public validate(body: Record<string, unknown>): ValidationResult {
    const unknown = Object.keys(body).filter((key) => !SearchBodyValidator.ALLOWED_KEYS.has(key));
    if (unknown.length > 0) {
      return {
        valid: false,
        error: `Unsupported search body key${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}.`,
      };
    }
    return { valid: true };
  }
}
