import {
  giftPlanIsBlocked,
  normalizeAccountKey,
  replayGiftHistoryPlan,
  sha256Json,
  stableStringify,
  validateGiftMaster,
} from "./gift_history_core.mjs";

function assert(value, message) {
  if (!value) throw new TypeError(`gift readback: ${message}`);
}

function canonicalEvents(master) {
  return master.events.map(({ occurredAtMs, ...event }) => event)
    .sort((a, b) => a.eventKey < b.eventKey ? -1 : a.eventKey > b.eventKey ? 1 : 0);
}

function canonicalSummary(rows) {
  assert(Array.isArray(rows), "summary rows are required");
  const seen = new Set();
  return rows.map(row => {
    assert(row && typeof row === "object", "summary row is invalid");
    assert(typeof row.recipientKey === "string" && row.recipientKey.trim(), "summary recipient is invalid");
    assert(typeof row.accountKey === "string", "summary account is invalid");
    const recipientKey = row.recipientKey.normalize("NFKC").trim();
    const accountKey = normalizeAccountKey(row.accountKey);
    assert(accountKey && !/[\t\r\n]/.test(recipientKey + accountKey), "summary identity is invalid");
    assert(typeof row.amount === "string" && /^(?:0|[1-9]\d*)$/.test(row.amount), "summary amount is invalid");
    assert(typeof row.firstAt === "string" && typeof row.lastAt === "string", "summary timestamps are invalid");
    const first = Date.parse(row.firstAt), last = Date.parse(row.lastAt);
    assert(Number.isFinite(first) && Number.isFinite(last) && first <= last, "summary timestamps are invalid");
    const key = JSON.stringify([recipientKey, accountKey]);
    assert(!seen.has(key), "summary key is duplicated");
    seen.add(key);
    return { recipientKey, accountKey, amount: row.amount,
      firstAt: new Date(first).toISOString(), lastAt: new Date(last).toISOString() };
  }).sort((a, b) => {
    const left = JSON.stringify([a.recipientKey, a.accountKey]);
    const right = JSON.stringify([b.recipientKey, b.accountKey]);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

// Callers own fresh, complete destination reads and write approval. This pure
// check verifies their normalized handoff; it cannot attest where data was read.
export function verifyGiftHistoryReadback({ reviewedPlan, beforeMaster, afterMaster, summaryRows }) {
  const replayed = replayGiftHistoryPlan({ master: beforeMaster, reviewedPlan });
  assert(replayed.planSha256 === reviewedPlan.planSha256, "reviewed plan does not match the pre-write master");
  assert(!giftPlanIsBlocked(replayed), "blocked plan cannot be verified as committed");
  const before = validateGiftMaster(beforeMaster);
  const after = validateGiftMaster(afterMaster);
  const expected = validateGiftMaster({ version: 1, events: replayed.target.events, syncLog: [] });
  const actualEvents = canonicalEvents(after);
  assert(stableStringify(actualEvents) === stableStringify(canonicalEvents(expected)), "event set differs from the reviewed target");
  const actualSummary = canonicalSummary(summaryRows);
  assert(stableStringify(actualSummary) === stableStringify(canonicalSummary(replayed.target.summaryRows)), "summary differs from the reviewed target");
  const snapshot = replayed.inputs.snapshot;
  const expectedLog = [...before.syncLog, {
    accountKey: normalizeAccountKey(snapshot.accountKey),
    snapshotDate: snapshot.snapshotDate,
    sourceSha256: snapshot.sourceSha256,
    status: replayed.mode === "unchanged" ? "unchanged" : "success",
  }];
  assert(stableStringify(after.syncLog) === stableStringify(expectedLog), "synchronization log differs from the prepared commit");
  return Object.freeze({
    version: 1,
    status: "verified",
    planSha256: replayed.planSha256,
    eventCount: actualEvents.length,
    summaryRowCount: actualSummary.length,
    totalAmount: actualEvents.reduce((total, event) => total + BigInt(event.amount), 0n).toString(),
    eventsSha256: sha256Json(actualEvents),
    summarySha256: sha256Json(actualSummary),
    syncLogSha256: sha256Json(after.syncLog),
  });
}
