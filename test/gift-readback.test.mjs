import assert from "node:assert/strict";
import test from "node:test";
import { buildGiftHistoryPlan } from "../scripts/gift_history_core.mjs";
import { verifyGiftHistoryReadback } from "../scripts/verify_gift_readback.mjs";

function fixture() {
  const old = { eventKey: "old", accountKey: "synthetic.sender", recipientKey: "synthetic.recipient",
    occurredAt: "2030-01-01T00:00:00.000Z", amount: "9007199254740993" };
  const priorLog = { accountKey: old.accountKey, snapshotDate: "2030-01-01", sourceSha256: "a".repeat(64), status: "success" };
  const beforeMaster = { version: 1, events: [old], syncLog: [priorLog] };
  const snapshot = { version: 1, accountKey: old.accountKey, snapshotDate: "2030-01-02",
    observedAt: "2030-01-02T12:00:00.000Z", sourceSha256: "b".repeat(64), rowCount: 1,
    events: [{ ...old, eventKey: "new", occurredAt: "2030-01-02T00:00:00.000Z", amount: "7" }] };
  const reviewedPlan = buildGiftHistoryPlan({ master: beforeMaster, snapshot, nowMs: Date.parse("2030-01-03T00:00:00Z") });
  const afterMaster = { version: 1, events: structuredClone(reviewedPlan.target.events),
    syncLog: [priorLog, { accountKey: snapshot.accountKey, snapshotDate: snapshot.snapshotDate,
      sourceSha256: snapshot.sourceSha256, status: "success" }] };
  return { reviewedPlan, beforeMaster, afterMaster, summaryRows: structuredClone(reviewedPlan.target.summaryRows) };
}

test("novel-event readback retains omitted history and verifies exact large totals", () => {
  const input = fixture();
  assert.equal(input.reviewedPlan.summary.additionCount, 1);
  assert.equal(input.reviewedPlan.summary.retainedMasterOnlyCount, 1);
  input.afterMaster.events.reverse();
  const receipt = verifyGiftHistoryReadback(input);
  assert.equal(receipt.status, "verified");
  assert.equal(receipt.eventCount, 2);
  assert.equal(receipt.totalAmount, "9007199254741000");
  assert.equal(receipt.summaryRowCount, 1);
  assert.equal(JSON.stringify(receipt).includes("synthetic.sender"), false);
});

for (const [name, change] of [
  ["missing novel event", x => x.afterMaster.events.pop()],
  ["lost master-only event", x => x.afterMaster.events.shift()],
  ["same-total wrong recipient", x => { x.afterMaster.events[0].recipientKey = "wrong"; }],
  ["duplicate event", x => x.afterMaster.events.push(x.afterMaster.events[0])],
  ["stale summary", x => { x.summaryRows[0].amount = "9007199254740993"; }],
  ["missing summary", x => { x.summaryRows = []; }],
  ["duplicate summary", x => x.summaryRows.push(x.summaryRows[0])],
  ["incorrect summary period", x => { x.summaryRows[0].lastAt = "2030-01-01T00:00:00Z"; }],
  ["missing commit log", x => x.afterMaster.syncLog.pop()],
  ["lost previous log", x => x.afterMaster.syncLog.shift()],
  ["duplicate commit log", x => x.afterMaster.syncLog.push(x.afterMaster.syncLog[1])],
  ["wrong source log", x => { x.afterMaster.syncLog[1].sourceSha256 = "c".repeat(64); }],
  ["stale pre-write master", x => { x.beforeMaster.events[0].amount = "1"; }],
  ["altered plan", x => { x.reviewedPlan.target.events[0].amount = "1"; }],
]) test(`rejects ${name}`, () => {
  const input = fixture(); change(input);
  assert.throws(() => verifyGiftHistoryReadback(input));
});

test("normalizes equivalent timestamp and account representations", () => {
  const input = fixture();
  input.afterMaster.events[0].occurredAt = "2030-01-01T09:00:00+09:00";
  input.summaryRows[0].firstAt = "2030-01-01T09:00:00+09:00";
  input.summaryRows[0].accountKey = "@SYNTHETIC.SENDER";
  assert.equal(verifyGiftHistoryReadback(input).status, "verified");
});

test("unchanged retry must retain events and carry an unchanged log entry", () => {
  const input = fixture();
  const beforeMaster = input.afterMaster;
  const reviewedPlan = buildGiftHistoryPlan({ master: beforeMaster, snapshot: input.reviewedPlan.inputs.snapshot,
    nowMs: Date.parse("2030-01-04T00:00:00Z") });
  assert.equal(reviewedPlan.mode, "unchanged");
  const afterMaster = { ...beforeMaster, syncLog: [...beforeMaster.syncLog, { ...beforeMaster.syncLog[1], status: "unchanged" }] };
  assert.equal(verifyGiftHistoryReadback({ reviewedPlan, beforeMaster, afterMaster, summaryRows: input.summaryRows }).status, "verified");
});

test("a blocked same-date replacement is never a verified commit", () => {
  const input = fixture();
  const beforeMaster = input.afterMaster;
  const reviewedPlan = buildGiftHistoryPlan({ master: beforeMaster,
    snapshot: { ...input.reviewedPlan.inputs.snapshot, sourceSha256: "d".repeat(64) },
    nowMs: Date.parse("2030-01-04T00:00:00Z") });
  assert.throws(() => verifyGiftHistoryReadback({ reviewedPlan, beforeMaster, afterMaster: beforeMaster,
    summaryRows: input.summaryRows }), /blocked plan/);
});
