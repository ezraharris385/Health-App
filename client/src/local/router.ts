/**
 * In-browser API router for local mode. Segment dispatcher modules register
 * handlers for the same paths the Express routes serve, so client/src/api/*
 * works identically in both modes (http.ts routes '/api/...' calls here when
 * VITE_LOCAL_MODE=1).
 *
 * Handler contract: return the JSON payload (object/array). Throw
 * LocalApiError(status, message) for expected errors; any other throw becomes
 * a 500. Params from ':name' segments arrive as strings, query values too —
 * exactly like Express.
 */

export class LocalApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type LocalHandler = (ctx: {
  params: Record<string, string>;
  query: Record<string, string>;
  body: any;
}) => unknown | Promise<unknown>;

type Method = "GET" | "POST" | "PUT" | "DELETE";

interface Route {
  method: Method;
  segments: string[]; // ':x' = param
  handler: LocalHandler;
}

const routes: Route[] = [];

export function route(method: Method, path: string, handler: LocalHandler): void {
  routes.push({ method, segments: path.split("/").filter(Boolean), handler });
}

export const get = (p: string, h: LocalHandler) => route("GET", p, h);
export const post = (p: string, h: LocalHandler) => route("POST", p, h);
export const put = (p: string, h: LocalHandler) => route("PUT", p, h);
export const del = (p: string, h: LocalHandler) => route("DELETE", p, h);

/** Dispatch a '/api/...' URL. Returns the payload; throws LocalApiError. */
export async function dispatch(method: Method, url: string, body?: unknown): Promise<unknown> {
  const [pathPart, queryPart] = url.split("?");
  const query: Record<string, string> = {};
  if (queryPart) {
    for (const [k, v] of new URLSearchParams(queryPart)) query[k] = v;
  }
  const parts = pathPart.split("/").filter(Boolean);

  for (const r of routes) {
    if (r.method !== method || r.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const seg = r.segments[i];
      if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(parts[i]);
      else if (seg !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    return r.handler({ params, query, body });
  }
  throw new LocalApiError(404, `No local route for ${method} ${pathPart}`);
}
