import assert from "node:assert/strict";
import test from "node:test";
import { decideStaleRecords, type PropertyRecord } from "../src/property_sweep.js";

test("selects records by each property's retention decision", () => {
  const records: PropertyRecord[] = [
    { kind: "maintenance_request", id: "old-work", closed_at: "2025-09-01T00:00:00Z", attachment_key: "work/old.jpg" },
    { kind: "maintenance_request", id: "recent-work", closed_at: "2025-12-15T00:00:00Z", attachment_key: "work/recent.jpg" },
    { kind: "tenant_document", id: "expired-lease", expires_at: "2025-12-31T23:59:59Z", object_key: "leases/expired.pdf" },
    { kind: "inspection_reminder", id: "recent-inspection", completed_at: "2025-12-20T00:00:00Z", report_key: "inspections/recent.pdf" },
  ];

  const result = decideStaleRecords(records, new Date("2026-01-01T00:00:00Z"));

  assert.deepEqual(result, {
    staleIds: ["old-work", "expired-lease"],
    objectKeys: ["work/old.jpg", "leases/expired.pdf"],
  });
});
