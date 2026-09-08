# Normalized gift readback verification

The additive `verifyGiftHistoryReadback` export accepts:

- `reviewedPlan`: the exact approved version 1 plan;
- `beforeMaster`: the saved, fresh pre-write master used by commit preparation;
- `afterMaster`: the complete canonical events and successful/unchanged log
  entries reread after the commit, using the existing master format;
- `summaryRows`: the complete managed summary in the plan's normalized format.

The function replays the plan against `beforeMaster` and rejects a changed or
blocked plan. It compares all event keys and values, exact integer totals,
recipient/account summary groups, first/last timestamps, and the entire previous
log followed by the prepared commit's one new entry. Event and summary row
ordering may differ; synchronization log ordering must remain append-only.
Duplicate keys, partial writes, missing historical events, stale summaries and
missing or duplicate commit entries stop verification. An unchanged commit
uses an `unchanged` entry, as prepared by `prepare_gift_commit.mjs`.

The return value contains counts and content hashes, without raw account or
recipient identifiers. It is not proof of source freshness, destination
identity, API completeness, formula preservation or write approval: the
destination adapter/caller must supply that evidence separately. The helper
performs no I/O and does not authorize a retry or repair.

Only the managed event-derived summary is covered. User-owned supplementary
rows, including separately approved zero-event identities, require an explicit
destination mapping and separate preservation checks; do not silently discard
unexpected rows to make verification pass. Pivot tables and Lark projections
remain outside this comparison. The pre-write backup and reviewed commit remain
the recovery evidence; restoration still requires its own authorization.
