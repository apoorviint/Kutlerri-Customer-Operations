import { z } from "zod";

/**
 * Internal API client. The response shape below is a PLACEHOLDER —
 * adjust ApiItem and mapItem() once the real endpoint/sample JSON is known.
 */
const ApiItem = z
  .object({
    id: z.union([z.string(), z.number()]),
    title: z.string().optional(),
    status: z.string().nullish(),
    category: z.string().nullish(),
    value: z.number().nullish(),
    date: z.string().nullish(),
  })
  .passthrough();

export type MappedRecord = {
  externalId: string;
  title: string;
  status: string | null;
  category: string | null;
  value: number | null;
  occurredAt: Date | null;
  payload: unknown;
};

function mapItem(raw: z.infer<typeof ApiItem>): MappedRecord {
  return {
    externalId: String(raw.id),
    title: raw.title ?? `Item ${raw.id}`,
    status: raw.status ?? null,
    category: raw.category ?? null,
    value: raw.value ?? null,
    occurredAt: raw.date ? new Date(raw.date) : null,
    payload: raw,
  };
}

function headers(): HeadersInit {
  const token = process.env.API_TOKEN;
  const h: Record<string, string> = { Accept: "application/json" };
  if (token) {
    const name = process.env.API_AUTH_HEADER || "Authorization";
    h[name] = name.toLowerCase() === "authorization" ? `Bearer ${token}` : token;
  }
  return h;
}

export async function fetchRecords(path = "/records"): Promise<MappedRecord[]> {
  const base = process.env.API_BASE_URL;
  if (!base) throw new Error("API_BASE_URL is not set");
  const res = await fetch(new URL(path, base), { headers: headers(), cache: "no-store" });
  if (!res.ok) throw new Error(`API ${res.status} ${res.statusText}`);
  const json = await res.json();
  const list = Array.isArray(json) ? json : (json.data ?? json.items ?? []);
  return z.array(ApiItem).parse(list).map(mapItem);
}
