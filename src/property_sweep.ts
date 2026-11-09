import { createHash } from "node:crypto";
import { infrai } from "./infrai.js";

export type PropertyRecord =
  | { kind: "maintenance_request"; id: string; closed_at: string; attachment_key: string }
  | { kind: "tenant_document"; id: string; expires_at: string; object_key: string }
  | { kind: "inspection_reminder"; id: string; completed_at: string; report_key: string };

export type SweepDecision = {
  staleIds: string[];
  objectKeys: string[];
};

const DAY = 86_400_000;

export function decideStaleRecords(records: PropertyRecord[], asOf: Date): SweepDecision {
  const stale = records.filter((record) => {
    if (record.kind === "maintenance_request") {
      return asOf.getTime() - Date.parse(record.closed_at) >= 90 * DAY;
    }
    if (record.kind === "tenant_document") {
      return Date.parse(record.expires_at) <= asOf.getTime();
    }
    return asOf.getTime() - Date.parse(record.completed_at) >= 30 * DAY;
  });

  return {
    staleIds: stale.map((record) => record.id),
    objectKeys: stale.map((record) => {
      if (record.kind === "maintenance_request") return record.attachment_key;
      if (record.kind === "tenant_document") return record.object_key;
      return record.report_key;
    }),
  };
}

export async function runPropertySweep(
  records: PropertyRecord[],
  asOf: Date,
  bucket: string,
): Promise<SweepDecision> {
  const decision = decideStaleRecords(records, asOf);
  if (decision.objectKeys.length === 0) return decision;

  const digest = createHash("sha256")
    .update(`${bucket}:${decision.objectKeys.slice().sort().join(",")}`)
    .digest("hex");
  await infrai.storage.object.delete_batch(bucket, decision.objectKeys, `property-sweep-${digest}`);
  return decision;
}
