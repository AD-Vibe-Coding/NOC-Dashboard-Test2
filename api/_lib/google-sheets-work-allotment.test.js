import test from "node:test";
import assert from "node:assert/strict";
import {
  selectHandoffCandidatePool,
  selectNextHandoffRecipient,
  selectS5HandoffPool,
  selectS6HandoffPool,
} from "./handoff-selection.js";
import { mergeOvernightS6Carryover } from "./shift-roster.js";

const member = (name, shiftCode) => ({ name, shiftCode, asrhRestricted: false });
const rosterMap = (...entries) => new Map(entries);

test("S5 hands to an eligible S6 member, never an S4 member", () => {
  const abhishek = member("Abhishek Benarji", "S6");
  const karthik = member("Karthik Damagalla", "S4");
  const byShift = rosterMap(["S4", [karthik]], ["S6", [abhishek]]);
  const pool = selectHandoffCandidatePool(["S6"], byShift);

  assert.deepEqual(pool.map((candidate) => candidate.name), ["Abhishek Benarji"]);
  assert.equal(selectNextHandoffRecipient(pool), "Abhishek Benarji");
});

test("S5 hands to an 11 PM–8 AM S6 member, never a 10 AM–7 PM S4 member", () => {
  const abhishek = member("Abhishek Benarji", "S6");
  const karthik = member("Karthik Damagalla", "S4");
  const byShift = rosterMap(["S4", [karthik]], ["S6", [abhishek]]);
  const candidates = selectHandoffCandidatePool(["S6"], byShift);
  const result = selectS5HandoffPool(candidates);

  assert.equal(result.targetSlot, "S6");
  assert.deepEqual(result.pool.map((candidate) => candidate.name), ["Abhishek Benarji"]);
  assert.equal(selectNextHandoffRecipient(result.pool), "Abhishek Benarji");
});

test("S6 hands to S1 when available and does not route to S2", () => {
  const s1 = member("Early shift owner", "S1");
  const s2 = member("Morning shift owner", "S2");
  const s6 = member("Overnight owner", "S6");
  const result = selectS6HandoffPool([s1], [s6]);

  assert.equal(result.targetSlot, "S1");
  assert.deepEqual(result.pool.map((candidate) => candidate.name), ["Early shift owner"]);
  assert.notEqual(result.pool[0].name, s2.name);
});

test("S6 falls back only to an S6 member when no S1 member is available", () => {
  const s2 = member("Morning shift owner", "S2");
  const s6 = member("Overnight owner", "S6");
  const result = selectS6HandoffPool([], [s6]);

  assert.equal(result.targetSlot, "S6");
  assert.deepEqual(result.pool.map((candidate) => candidate.name), ["Overnight owner"]);
  assert.notEqual(result.pool[0].name, s2.name);
});

test("no eligible next-shift candidate means no invented carried-primary recipient", () => {
  assert.equal(selectNextHandoffRecipient([]), null);
  assert.equal(selectNextHandoffRecipient(), null);
});

test("yesterday's overnight Abhishek is included in today's S1 and S2 despite a WO cell", () => {
  const todayRoster = {
    members: [{ name: "Abhishek Benarji", shiftCode: null, offReason: "WO" }],
  };
  const previousS6 = [{
    name: "Abhishek Benarji",
    shiftCode: "S6",
    shiftWindow: { start: 23 * 60, end: 8 * 60 },
    offReason: null,
  }];

  for (const [slot, postMinutes] of [["S1", 2 * 60 + 25], ["S2", 6 * 60 + 25]]) {
    const merged = mergeOvernightS6Carryover(todayRoster, previousS6, slot, postMinutes);
    const abhishek = merged.members.find((candidate) => candidate.name === "Abhishek Benarji");
    assert.equal(abhishek.shiftCode, "S6", `${slot} should retain his overnight shift code`);
    assert.equal(abhishek.offReason, null, `${slot} should not treat him as off while his shift is active`);
  }
});

test("overnight S6 carryover expires after the 8 AM shift end", () => {
  const todayRoster = { members: [{ name: "Abhishek Benarji", shiftCode: null, offReason: "WO" }] };
  const previousS6 = [{
    name: "Abhishek Benarji",
    shiftCode: "S6",
    shiftWindow: { start: 23 * 60, end: 8 * 60 },
    offReason: null,
  }];

  const merged = mergeOvernightS6Carryover(todayRoster, previousS6, "S3", 8 * 60 + 25);
  assert.equal(merged.members[0].offReason, "WO");
  assert.equal(merged.members[0].shiftCode, null);
});

test("a real current-day shift takes precedence over yesterday's S6 carryover", () => {
  const currentMember = { name: "Abhishek Benarji", shiftCode: "S4", offReason: null };
  const roster = { members: [currentMember] };
  const previousS6 = [{
    name: "Abhishek Benarji",
    shiftCode: "S6",
    shiftWindow: { start: 23 * 60, end: 8 * 60 },
    offReason: null,
  }];

  const merged = mergeOvernightS6Carryover(roster, previousS6, "S1", 2 * 60 + 25);
  assert.equal(merged.members[0].shiftCode, "S4");
});
