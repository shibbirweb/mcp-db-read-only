import { defineEngineSuite } from "../helpers/engineSuite.js";
import fixture from "../helpers/engines/clickhouse.js";

await defineEngineSuite(fixture);
