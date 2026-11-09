import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { InfraiError, infrai } from "./infrai.js";
import { runPropertySweep, type PropertyRecord } from "./property_sweep.js";

const port = Number(process.env.PORT ?? 3000);
const bucket = process.env.PROPERTY_RECORDS_BUCKET ?? "property-records";
const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${port}`;

const sweepBody = z.object({
  as_of: z.string().datetime().optional(),
});

const records: PropertyRecord[] = [
  {
    kind: "maintenance_request",
    id: "maint-1042",
    closed_at: "2025-10-01T10:00:00.000Z",
    attachment_key: "maintenance/maint-1042/photo.jpg",
  },
  {
    kind: "tenant_document",
    id: "lease-88",
    expires_at: "2025-12-31T23:59:59.000Z",
    object_key: "tenants/lease-88.pdf",
  },
  {
    kind: "inspection_reminder",
    id: "inspection-73",
    completed_at: "2026-08-30T09:00:00.000Z",
    report_key: "inspections/inspection-73.pdf",
  },
];

function errorResponse(error: unknown, response: Response): void {
  if (error instanceof z.ZodError) {
    response.status(400).json({ ok: false, error: { code: "INVALID_SWEEP_INPUT", issues: error.issues } });
    return;
  }
  if (error instanceof InfraiError) {
    const status = error.status >= 400 && error.status < 500 ? error.status : 502;
    response.status(status).json({ ok: false, error: { code: error.code, message: error.message } });
    return;
  }
  response.status(500).json({ ok: false, error: { code: "CLEANUP_FAILED" } });
}

async function startServer(): Promise<void> {
  await infrai.storage.bucket.create(bucket, `property-bucket-${bucket}`);
  const app = express();
  app.use(express.json());
  app.post("/cleanup/sweep", async (request: Request, response: Response, next: NextFunction) => {
    try {
      const body = sweepBody.parse(request.body ?? {});
      const asOf = body.as_of ? new Date(body.as_of) : new Date();
      const decision = await runPropertySweep(records, asOf, bucket);
      response.json({
        ok: true,
        as_of: asOf.toISOString(),
        stale_record_ids: decision.staleIds,
        deleted_object_count: decision.objectKeys.length,
      });
    } catch (error) {
      next(error);
    }
  });
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    errorResponse(error, response);
  });
  app.listen(port, () => console.log(`Property cleanup listening on ${publicUrl}`));
}

async function scheduleSweep(): Promise<void> {
  const result = await infrai.cron.create(
    "15 2 * * *",
    `${publicUrl}/cleanup/sweep`,
    `property-cleanup-${publicUrl}`,
  );
  console.log(JSON.stringify({ scheduled: true, job_id: result.job_id }, null, 2));
}

async function cleanupResources(): Promise<void> {
  const jobId = process.argv[3];
  const bucketName = process.argv[4];
  if (!jobId || !bucketName) {
    throw new Error("Usage: npm run cleanup -- <job_id> <bucket_name>; use - for no cron job");
  }
  if (jobId !== "-") {
    await infrai.cron.delete(jobId);
    const jobs = await infrai.cron.list();
    if (JSON.stringify(jobs).includes(jobId)) throw new Error("Cron deletion could not be verified");
  }
  // Bucket deletion deliberately requires an empty bucket: never erase user objects.
  await infrai.storage.bucket.delete(bucketName);
  try {
    await infrai.storage.object.list(bucketName);
  } catch (error) {
    if (error instanceof InfraiError && error.status === 404) {
      console.log(JSON.stringify({ cleaned: true, job_id: jobId, bucket: bucketName }));
      return;
    }
    throw error;
  }
  throw new Error("Bucket deletion could not be verified");
}

if (process.argv[2] === "cleanup") {
  await cleanupResources();
} else if (process.argv[2] === "schedule") {
  await scheduleSweep();
} else {
  await startServer();
}
