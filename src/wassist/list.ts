import { z } from 'zod';
import type { RequestSpec, WassistHttp } from './http.js';

/** One page of results. `total` and `nextOffset` are null when Wassist does not say. */
export interface Page<T> {
  items: T[];
  total: number | null;
  nextOffset: number | null;
}

/** The limit and offset a tool asks for. */
export interface PageParams {
  limit: number;
  offset: number;
}

/** The `{ count, next, results }` shape that some Wassist list endpoints answer with. */
interface Envelope<T> {
  count: number;
  next?: string | null | undefined;
  results: T[];
}

/** A list as Wassist sends it, in either shape. */
type ListBody<T> = T[] | Envelope<T>;

/**
 * Accepts a list as either a bare array or an envelope. The official OpenAPI file and the live API
 * disagree on which one each endpoint uses, so every list parser takes both.
 */
function listResponse<S extends z.ZodType>(item: S): z.ZodType<ListBody<z.output<S>>> {
  return z.union([
    z.array(item),
    z.object({ count: z.number().int(), next: z.string().nullish(), results: z.array(item) }),
  ]);
}

/** Cuts a whole list down to the requested page. Used when Wassist ignores limit and offset. */
function sliceLocally<T>(body: ListBody<T>, { offset, limit }: PageParams): Page<T> {
  const items = Array.isArray(body) ? body : body.results;
  const end = offset + limit;
  return {
    items: items.slice(offset, end),
    total: Array.isArray(body) ? items.length : body.count,
    nextOffset: end < items.length ? end : null,
  };
}

/** Reads a page Wassist already cut. It reports a next page when the answer says there is one. */
function readServerPage<T>(body: ListBody<T>, { offset, limit }: PageParams): Page<T> {
  const items = (Array.isArray(body) ? body : body.results).slice(0, limit);
  // A bare array has no "next" field, so a full page is the only hint that more may follow.
  const hasMore = Array.isArray(body) ? items.length >= limit : Boolean(body.next);
  return {
    items,
    total: Array.isArray(body) ? null : body.count,
    nextOffset: hasMore ? offset + items.length : null,
  };
}

/**
 * Fetches a list endpoint that pages on the Wassist side, so only the requested page is
 * transferred. `query` carries the endpoint's own filters.
 */
export async function fetchPage<S extends z.ZodType>(
  http: WassistHttp,
  path: string,
  query: RequestSpec['query'],
  item: S,
  page: PageParams,
  signal?: AbortSignal,
): Promise<Page<z.output<S>>> {
  const body = await http.request(
    { method: 'GET', path, query: { limit: page.limit, offset: page.offset, ...query } },
    listResponse(item),
    signal,
  );
  return readServerPage(body, page);
}

/**
 * Fetches a list endpoint that ignores limit and offset, then cuts the requested page here.
 * Fine for the short lists these endpoints return. `query` carries the endpoint's own filters.
 */
export async function fetchAll<S extends z.ZodType>(
  http: WassistHttp,
  path: string,
  query: RequestSpec['query'],
  item: S,
  page: PageParams,
  signal?: AbortSignal,
): Promise<Page<z.output<S>>> {
  const body = await http.request({ method: 'GET', path, query }, listResponse(item), signal);
  return sliceLocally(body, page);
}

/** Fetches a list endpoint that answers with everything at once, for a lookup across the whole list. */
export async function fetchList<S extends z.ZodType>(
  http: WassistHttp,
  path: string,
  item: S,
  signal?: AbortSignal,
): Promise<z.output<S>[]> {
  const body = await http.request({ method: 'GET', path }, listResponse(item), signal);
  return Array.isArray(body) ? body : body.results;
}

/** Applies `transform` to every item on a page and keeps the paging fields. */
export function mapPage<T, U>(page: Page<T>, transform: (item: T) => U): Page<U> {
  return { ...page, items: page.items.map(transform) };
}
