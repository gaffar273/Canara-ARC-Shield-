import type { Role } from "./types.js";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

async function unwrap<T>(res: Response): Promise<T> {
  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError("NETWORK", `Invalid response from ${res.url} (${res.status})`);
  }
  if (!body.ok) {
    throw new ApiError(body.error.code, body.error.message);
  }
  return body.data;
}

function headers(role: Role): HeadersInit {
  return { "x-role": role };
}

export async function get<T>(path: string, role: Role = "compliance"): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: headers(role) });
  return unwrap<T>(res);
}

export async function post<T>(path: string, body: unknown, role: Role = "compliance"): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { ...headers(role), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap<T>(res);
}

export async function del<T>(path: string, role: Role = "compliance"): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "DELETE",
    headers: headers(role),
  });
  return unwrap<T>(res);
}

export async function put<T>(path: string, body: unknown, role: Role = "compliance"): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { ...headers(role), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap<T>(res);
}

export async function upload<T>(path: string, formData: FormData, role: Role = "compliance"): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: headers(role),
    body: formData,
  });
  return unwrap<T>(res);
}
