# MySQL teaching engine

This independent Rust workspace interprets the published MySQL 8.0 teaching
subset. It has no database connection, host filesystem, process, network, WASI,
or user JavaScript execution interface.

`execute(bytes, build_id, &mut budget::Meter)` accepts canonical, closed JSON.
The browser wrapper exports `execute_mysql(bytes, build_id, remaining_ms)`.
Both use the same source parser, type checker, relational evaluator, statement
executor, judge and trace producer. The build identifier is the actual WASM SHA.

The current request SQL is parsed with the pinned MySQL sqlparser dialect and
a recursion limit of 64. The complete script is checked for supported structure
before execution. Names, types and grouping are checked against table schemas
even for empty relations. The fixed profile file supplies initial sessions and
expected results; it never replaces the submitted SQL.

Integer arithmetic is checked against JSON safe integers, while stored INT
values remain INT32. SUM produces an exact scale-zero decimal string. AVG uses
an exact numerator/count and HALF_UP scale-four display, and is accepted only as
a direct projection. NULL uses SQL three-valued logic. Text uses Unicode scalar
lengths and binary, non-padding comparison.
IFNULL, COALESCE, AND and OR bind every expression statically and evaluate only
the runtime branches needed for their SQL result. HAVING gives source/grouped
column names precedence over same-named projection aliases.

Queries record their actual scan, filter, join, group, projection, distinct,
ordering and limit stages. Intermediate relations borrow verified stored cells
to avoid multiplying text allocations in self joins. Owned projected values are
admitted with the retained trace, parser/profile and final-packet allowance under
the same 128 MiB memory ceiling.

Every DML or DDL statement stages its entire candidate session. Row order,
left-to-right UPDATE assignments, type checks and uniqueness are evaluated
against that candidate. Full constraints and the commit step/checkpoint budgets
must pass before one atomic step publishes session, result and completed control.
Failures retain the previously committed session and a reversible valid prefix.
Transactions may continue across requests and ROLLBACK restores their exact base.
Transaction exercises additionally require private evidence that an actual write
and its rollback occurred in the same transaction episode; a write followed by
COMMIT and an unrelated ROLLBACK cannot satisfy that goal.

All four judge cases share fuel, steps and the original deadline. Case sessions
are isolated, unordered comparisons preserve duplicates, and only the selected
case retains its replay. Incomplete or failed cases cannot pass. Canonical final
encoding reaches a fixed point for the self-inclusive `usage.resultBytes`.

Build with `node scripts/build-mysql-wasm.mjs` from the repository root. The
existing toolchain checks, path remapping, import inspection, maximum memory and
engine SHA lock apply. Native checks use this workspace's locked manifest.
Only sqlparser is optimized in native development/tests so its recursion guard
can fire before unoptimized native parser frames exhaust the default test stack;
the WASM release follows the normal optimized build.
