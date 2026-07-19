export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

// Local mode: no server — dispatch through the in-browser router instead of
// fetch. The dynamic import keeps the local runtime out of the server-mode
// bundle (the condition is a build-time constant, so the branch is dropped).
const LOCAL_MODE = import.meta.env.VITE_LOCAL_MODE === "1";

async function local<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
): Promise<T> {
  const { dispatch, LocalApiError } = await import("../local/router");
  try {
    // Round-trip the body through JSON to reproduce the server-mode boundary
    // (JSON.stringify + express.json): NaN/Infinity -> null, Dates -> strings,
    // explicit-undefined properties dropped.
    const wireBody = body === undefined ? undefined : JSON.parse(JSON.stringify(body));
    return (await dispatch(method, url, wireBody)) as T;
  } catch (err) {
    if (err instanceof LocalApiError) throw new ApiError(err.status, err.message);
    // Match server mode, where unexpected errors surface as Express's plain
    // "Internal Server Error" — never raw internal messages.
    console.error(err);
    throw new ApiError(500, "Internal Server Error");
  }
}

export const http = {
  get: <T>(url: string) =>
    LOCAL_MODE ? local<T>("GET", url) : fetch(url).then((r) => handle<T>(r)),
  post: <T>(url: string, body?: unknown) =>
    LOCAL_MODE
      ? local<T>("POST", url, body ?? {})
      : fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
        }).then((r) => handle<T>(r)),
  put: <T>(url: string, body?: unknown) =>
    LOCAL_MODE
      ? local<T>("PUT", url, body ?? {})
      : fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
        }).then((r) => handle<T>(r)),
  del: <T>(url: string) =>
    LOCAL_MODE
      ? local<T>("DELETE", url)
      : fetch(url, { method: "DELETE" }).then((r) => handle<T>(r)),
};

/** Local calendar date as YYYY-MM-DD */
export function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
