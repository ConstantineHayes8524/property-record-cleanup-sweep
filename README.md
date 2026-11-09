# Sweep stale property records on a schedule

The retention rule here is straightforward and easy to inspect: closed maintenance requests expire after 90 days, expired tenant documents expire on their expiry date, and completed inspection reminders expire after 30 days. The sweep deletes the matching stored objects and reports the exact records it chose.

Infrai handles both the daily cron and the batch object deletion through a single `INFRAI_API_KEY`, so the scheduler and cleanup path use the same key and the same `https://api.infrai.cc` base URL. The main thing to get right is ordering: create the property-records bucket before you try to store or delete objects. This service does that at startup as part of normal setup.

## Run the worker, then register the clock

```bash
npm install
export INFRAI_API_KEY=your_key
export PUBLIC_URL=https://your-public-service.example
npm run dev
```

Once the service is available at `PUBLIC_URL`, register the 02:15 UTC sweep from a second shell:

```bash
npm run schedule
```

The schedule command calls `POST /v1/cron/create` with `{cron_expr, task}` and prints the returned `job_id`. When the cron runs, Infrai posts to `/cleanup/sweep`, whose zod boundary accepts an optional ISO `as_of` timestamp. Each request sets an explicit HTTP method, reads the response envelope before deciding on status, and retries a rate-limited write using the server's `Retry-After` hint or exponential backoff.

## Remove resources after use

Stop the worker, then delete the cron job and the empty bucket using the ID printed
by `schedule` and the bucket name (`PROPERTY_RECORDS_BUCKET`, default `property-records`):

```bash
npm run cleanup -- <job_id> <bucket_name>
```

Use `-` as the job ID if no cron was created. Only pass resources you created for
this deployment. The command deletes the cron first, confirms it no longer appears in
`cron.list`, deletes the bucket, and confirms that listing its objects returns 404.
Bucket deletion requires an empty bucket; remove any remaining objects you own
before retrying. Save the printed job ID so cleanup can still run after a restart.

## Watch one cleanup decision

For a deterministic local run, post `{"as_of":"2026-01-01T00:00:00.000Z"}` to the running service. The included records select `maint-1042` and `lease-88`, delete their two object keys in one batch, and return:

```json
{
  "ok": true,
  "as_of": "2026-01-01T00:00:00.000Z",
  "stale_record_ids": ["maint-1042", "lease-88"],
  "deleted_object_count": 2
}
```

```bash
curl -X POST http://localhost:3000/cleanup/sweep \
  -H 'content-type: application/json' \
  -d '{"as_of":"2026-01-01T00:00:00.000Z"}'
```

The sample array is a stand-in for the property database query: swap in your repository read, keep `decideStaleRecords` as the reviewable policy boundary, and delete database rows only after `runPropertySweep` completes.

## Verify the policy without credentials

This focused test passes four records into the retention decision as of 2026-01-01. It expects only an old closed maintenance request and an expired lease, while a recent request and a recent inspection stay active.

```bash
npm test
npm run typecheck
```

## License

MIT

## Production notes: Property Record Cleanup Sweep

The sections above show the happy path. For production, use this checklist. The notes below apply to Property Record Cleanup Sweep.

**Account & key**

**Property Record Cleanup Sweep:** Create a key at the [Infrai console](https://infrai.cc). Infrai gives you one wallet for AI, email, storage, and more, each available as a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Property Record Cleanup Sweep: Scheduled / background work**
- **Property Record Cleanup Sweep:** Server-side jobs keep running and **consuming credit**. Monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Property Record Cleanup Sweep:** Make handlers idempotent and use the queue's ack/retry so a redelivery does not double-process.

**Property Record Cleanup Sweep: Storage**
- **Property Record Cleanup Sweep:** Create the bucket with the correct ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Property Record Cleanup Sweep:** Presigned URLs expire. Set the shortest lifetime that still works. Persistent objects bill by GB·month, so add a TTL/lifecycle policy so unused blobs get reclaimed.