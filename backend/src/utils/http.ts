import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { ErrorCode } from "./errors.js";
import { fail } from "./errors.js";

export interface Ok<T> {
  ok: true;
  data: T;
}

export interface Err {
  ok: false;
  error: { code: ErrorCode; message: string };
}

export function sendOk<T>(res: Response, data: T, status = 200): void {
  const body: Ok<T> = { ok: true, data };
  res.status(status).json(body);
}

export function sendErr(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
): void {
  const body: Err = { ok: false, error: { code, message } };
  res.status(status).json(body);
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** Extracts a required route param, throwing BAD_REQUEST if absent. */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw fail("BAD_REQUEST", `Missing route parameter '${name}'`);
  }
  return value;
}
