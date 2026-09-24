# Design Patterns

Each pattern here is used because it closed a specific problem. Where a pattern is not used, that is deliberate too.

## Strategy: one driver per engine

`DatabaseDriver` is the interface every engine implements (`src/drivers/DatabaseDriver.ts`). The browse tools call `listObjects`, `describeObject` and `sample` without knowing which engine answers, which is what lets eight engines share five browse tools.

Capabilities an engine lacks default to a refusal in `BaseDriver`, so Redis needs no code to say it has no foreign keys, and the message says what it has instead.

Family interfaces (`SqlDriver`, `DocumentDriver`, `KeyValueDriver`, `SearchDriver`) extend the common one with the query method that family actually has. There is no generic `execute(anything)` on the base interface, on purpose: a SQL string, a MongoDB pipeline and a Redis command have nothing in common worth unifying behind a loosely typed argument, and a generic method is exactly what layer two must not offer.

## Abstract Factory: `DriverRegistry`

A map from engine to a factory function, filled in by `ApplicationFactory`. Nothing else names a concrete driver. Tests register a fake factory and exercise `DriverCache` without a database.

## Object Pool with LRU eviction: `DriverCache`

One driver per distinct `ConnectionTarget.key()`, capped at eight, evicting the least recently used. A JavaScript `Map` iterates in insertion order, so delete-and-reinsert moves an entry to the back; that is a complete LRU in two operations.

Added over the MySQL-only predecessor: a cached driver whose target has the same key but a different password is replaced rather than reused. The key excludes the password by design, so without this a reconnect with corrected credentials kept failing on the old driver.

## Lazy Initialisation: `LazyResource`

Every driver holds its client in one. Constructing a driver does no I/O, which is what lets a tool resolve a driver, validate its input against the driver's dialect, and still reject the call without opening a connection. A failed open is forgotten, so a server that was down when first asked is retried on the next call rather than remembered as down forever.

## Template Method: `BaseTool` and `DatabaseScopedTool`

`BaseTool` fixes `register` and `invoke`; subclasses supply `execute`. That makes the error contract impossible to forget: every thrown error becomes a tool error, so a dead host cannot take the client's session down.

`DatabaseScopedTool` refines it: `execute` resolves the active target, checks the tool's `family` against the engine, validates the per-call `database` with the engine's name policy, and then calls the subclass's `read`. Without it, fifteen tools would each repeat three guards.

## Chain of Responsibility: the SQL rules

`ReadOnlyQueryValidator` walks a list of rules, each of which objects or passes. The rules are shared by every SQL dialect; what differs per dialect is data (`SqlDialect`: lexing rules and word lists), not code. Adding a check is one class; adding a dialect is one table entry.

## Facade: `DriverProvider`

Tools ask one object which connection a call belongs to and for a driver of the right family. How a target becomes a driver, and how a mismatch becomes a helpful error, stays behind it.

## Registry: `ConnectionRegistry`

The one place mutable connection state lives, as an injected instance rather than module state, so tests can build as many as they like.

## Value Object: `ConnectionTarget`

Immutable, compared by value, with `withDatabase` returning a copy. Its `key()` is both its identity and its display form, so what is logged can never drift from what is cached, and it excludes the password and every secret URL option by construction.

## Data over inheritance: `EngineCatalog` and `SqlDialects`

Both are tables. The connection layer needs facts about an engine (its schemes, whether it switches databases) long before any driver exists, and must not load a driver module to learn them. The SQL dialects differ only in word lists and lexing flags, and a table of those is easier to review than five subclasses overriding each other.

## Deliberately not used

**No generic "query" abstraction across engine families.** Considered and rejected: it would force either a lowest-common-denominator query language or a loosely typed argument whose meaning changes with the engine, and it would put a generic send method on every driver.

**No plugin loading.** Every driver ships in the package and is loaded on first use. A plugin mechanism would let code outside this repository run inside a process holding database credentials.
