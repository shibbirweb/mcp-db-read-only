import { defineEngineSuite } from "../helpers/engineSuite.js";
import fixture from "../helpers/engines/redis.js";

await defineEngineSuite(fixture);
