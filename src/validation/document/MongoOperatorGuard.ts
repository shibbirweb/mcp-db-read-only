import type { ValidationResult } from "../../types/validation.types.js";

/**
 * Rejects MongoDB filters and pipelines that contain a forbidden operator
 * anywhere, at any depth.
 *
 * Layer one for MongoDB, run by the tools before a driver is touched. It is a
 * denylist, walked recursively, because the dangerous operators can hide
 * inside `$facet`, `$lookup.pipeline`, `$unionWith`, `$expr` and each other:
 *
 * - `$out` and `$merge` write the pipeline's result into a collection.
 * - `$function`, `$accumulator` and `$where` run JavaScript on the server,
 *   which cannot write through a read but can run for as long as it likes.
 * - `$changeStream` opens a cursor that never finishes by design.
 *
 * Layer two is a different mechanism on purpose: MongoStageAllowlist, inside
 * the driver, permits only known read stages. One is a denylist of operators,
 * the other an allowlist of stages, so a mistake in one is not repeated in the
 * other.
 */
export class MongoOperatorGuard {
  public static readonly FORBIDDEN: ReadonlyMap<string, string> = new Map([
    ["$out", "$out writes the result into a collection"],
    ["$merge", "$merge writes the result into a collection"],
    ["$function", "$function runs JavaScript on the server"],
    ["$accumulator", "$accumulator runs JavaScript on the server"],
    ["$where", "$where runs JavaScript on the server"],
    ["$changeStream", "$changeStream opens a cursor that never completes"],
  ]);

  /**
   * Deep enough for any real pipeline, and a bound on a hostile one: a value
   * nested ten thousand levels deep would otherwise exhaust the stack.
   */
  private static readonly MAX_DEPTH = 64;

  public validate(value: unknown, label: string): ValidationResult {
    const found = this.findForbidden(value, 0);
    if (found === "too-deep") {
      return { valid: false, error: `The ${label} is nested too deeply.` };
    }
    if (found) {
      return {
        valid: false,
        error: `The ${label} uses ${found}, which is not allowed: ${MongoOperatorGuard.FORBIDDEN.get(found)}.`,
      };
    }
    return { valid: true };
  }

  private findForbidden(value: unknown, depth: number): string | null {
    if (depth > MongoOperatorGuard.MAX_DEPTH) {
      return "too-deep";
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = this.findForbidden(item, depth + 1);
        if (found) {
          return found;
        }
      }
      return null;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (MongoOperatorGuard.FORBIDDEN.has(key)) {
          return key;
        }
        const found = this.findForbidden(child, depth + 1);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }
}
