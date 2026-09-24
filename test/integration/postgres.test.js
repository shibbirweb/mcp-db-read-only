import { defineEngineSuite } from "../helpers/engineSuite.js";
import fixture from "../helpers/engines/postgres.js";

await defineEngineSuite(fixture);
