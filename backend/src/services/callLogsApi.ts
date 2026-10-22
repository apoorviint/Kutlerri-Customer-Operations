import { config } from "../config.js";

// The API allows at most 500 rows per page.
const PAGE_SIZES = [500, 499, 497, 491];

type Page = { items: unknown[]; total: number };

async function getPage(path: string, params: Record<string, string>): Promise<Page> {
  const url = new URL(config.callLogsApi.baseUrl + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (config.callLogsApi.token) headers.Authorization = `Bearer ${config.callLogsApi.token}`;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`${path} responded ${res.status}`);
      const body = (await res.json()) as { items?: unknown; total?: unknown };
      if (!Array.isArray(body.items) || typeof body.total !== "number") throw new Error(`${path} returned an unexpected shape`);
      return { items: body.items, total: body.total };
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function walk(
  path: string, idKey: string, from: string, to: string, perPage: number, seen: Set<string>, onPage: (items: unknown[]) => Promise<void>,
) {
  let fetched = 0;
  for (let page = 1; ; page++) {
    const res = await getPage(path, { page: String(page), per_page: String(perPage), date_from: from, date_to: to });
    for (const raw of res.items) {
      const id = (raw as Record<string, unknown> | null)?.[idKey];
      if (id != null) seen.add(String(id));
    }
    await onPage(res.items);
    fetched += res.items.length;
    if (res.items.length === 0 || fetched >= res.total) return res.total;
  }
}

/**
 * Reads every row the API has for a date window (inclusive), page by page.
 *
 * The API pages by position over a list sorted by date and time, and many rows share the same second.
 * A row on a page boundary can therefore appear twice while a neighbour is skipped (this lost 2 of 80,154
 * calls in testing). So we count the distinct ids we received; if that is fewer than the API's total, we read the
 * window again with a different page size, which moves the boundaries, until nothing is missing.
 */
export async function fetchWindow(
  path: "/v1/calls" | "/v1/emails", idKey: string, from: string, to: string, onPage: (items: unknown[]) => Promise<void>,
) {
  const seen = new Set<string>();
  let total = 0;
  let passes = 0;
  for (const size of PAGE_SIZES) {
    passes++;
    total = await walk(path, idKey, from, to, size, seen, onPage);
    if (seen.size >= total) break;
  }
  return { distinct: seen.size, total, passes };
}
