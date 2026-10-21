import assert from "node:assert/strict";
import test from "node:test";

import { parseFindings } from "../lib/findings.js";

test("parseFindings counts statuses and identifies completion blockers", () => {
  const findings = parseFindings(`# Findings

### F-01 [P2] open - Small maintainability issue

### F-02 [P1] fixed - Repair needs review

### F-03 [P0] accepted - Risk accepted with a reason
`);

  assert.equal(findings.total, 3);
  assert.equal(findings.byStatus.open, 1);
  assert.equal(findings.byStatus.fixed, 1);
  assert.equal(findings.byStatus.accepted, 1);
  assert.deepEqual(findings.blockers.map((finding) => finding.id), ["F-02"]);
  assert.deepEqual(findings.warnings, []);
});

test("parseFindings warns about malformed machine-readable headings", () => {
  const findings = parseFindings(`### F-01 [P1] waiting - Unknown status\n`);

  assert.equal(findings.total, 0);
  assert.equal(findings.warnings[0]?.code, "malformed_findings");
});
