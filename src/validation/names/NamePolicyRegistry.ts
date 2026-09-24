import type { Engine } from "../../domain/Engine.js";
import { EngineCatalog } from "../../domain/Engine.js";
import {
  ElasticNamePolicy,
  MongoNamePolicy,
  RedisNamePolicy,
  SqlNamePolicy,
} from "./NamePolicy.js";
import type { NamePolicy } from "./NamePolicy.js";

/**
 * Picks the naming rules for an engine.
 *
 * Tools validate names against the active engine before any driver is
 * touched, so a malformed name costs no connection, and they do it through
 * this one lookup so no tool can quietly apply SQL rules to a Redis key.
 */
export class NamePolicyRegistry {
  constructor(
    private readonly sql: NamePolicy = new SqlNamePolicy(),
    private readonly mongo: NamePolicy = new MongoNamePolicy(),
    private readonly redis: NamePolicy = new RedisNamePolicy(),
    private readonly elastic: NamePolicy = new ElasticNamePolicy()
  ) {}

  public for(engine: Engine): NamePolicy {
    switch (EngineCatalog.describe(engine).family) {
      case "sql":
        return this.sql;
      case "document":
        return this.mongo;
      case "keyvalue":
        return this.redis;
      case "search":
        return this.elastic;
    }
  }
}
