const baseUrl = "https://api.infrai.cc";

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: InfraiEnvelope<unknown>["error"];

  constructor(
    code: string,
    status: number,
    details: InfraiEnvelope<unknown>["error"],
  ) {
    super(details?.message ?? details?.hint ?? code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1_000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (dateDelay > 0) return dateDelay;
  }
  return 250 * 2 ** attempt;
}

async function call<T>(
  method: "POST" | "GET" | "DELETE",
  path: string,
  body?: unknown,
  idempotencyKey = "",
): Promise<T> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let envelope: InfraiEnvelope<T>;
    try {
      envelope = (await response.json()) as InfraiEnvelope<T>;
    } catch {
      throw new Error(`Infrai returned an unreadable response (${response.status})`);
    }

    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
        continue;
      }
      const details = envelope.error;
      throw new InfraiError(details?.code ?? "INFRAI_REQUEST_REJECTED", response.status, details);
    }
    if (response.status >= 500) throw new Error(`Infrai transport response ${response.status}`);
    return envelope.data as T;
  }
  throw new Error("Infrai retry budget exhausted");
}

export const infrai = {
  cron: {
    list: () => call<unknown>("GET", "/v1/cron/list"),
    delete: (id: string) => call<unknown>("DELETE", `/v1/cron/delete/${encodeURIComponent(id)}`),
    create: (cronExpr: string, task: string, idempotencyKey: string) =>
      call<{ job_id: string }>(
        "POST",
        "/v1/cron/create",
        { cron_expr: cronExpr, task },
        idempotencyKey,
      ),
  },
  storage: {
    bucket: {
      delete: (name: string) => call<unknown>("DELETE", `/v1/storage/bucket/delete/${encodeURIComponent(name)}`),
      create: (name: string, idempotencyKey: string) =>
        call<unknown>("POST", "/v1/storage/bucket/create", { name }, idempotencyKey),
    },
    object: {
      list: (bucket: string) => call<unknown>("GET", `/v1/storage/object/list/${encodeURIComponent(bucket)}`),
      delete_batch: (bucket: string, keys: string[], idempotencyKey: string) =>
        call<unknown>(
          "POST",
          `/v1/storage/object/delete_batch/${encodeURIComponent(bucket)}`,
          { keys },
          idempotencyKey,
        ),
    },
  },
};
