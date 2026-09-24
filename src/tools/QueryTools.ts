import type { QueryToolIndex } from "../drivers/DriverProvider.js";

/**
 * The query tools for each engine family.
 *
 * Lives beside the tools rather than in the engine catalog, because the
 * domain layer should not know tool names. DriverProvider receives it so that
 * calling a query tool against the wrong engine names the right ones.
 */
export const QUERY_TOOLS: QueryToolIndex = {
  sql: ["run_query"],
  document: ["find_documents", "aggregate", "count_documents", "distinct_values"],
  keyvalue: ["redis_command"],
  search: ["search"],
};
