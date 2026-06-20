import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors.js";
import { sendErr } from "../utils/http.js";

export function notFound(_req: Request, res: Response): void {
  sendErr(res, 404, "NOT_FOUND", "Route not found");
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    sendErr(res, err.status, err.code, err.message);
    return;
  }
  const message = err instanceof Error ? err.message : "Unexpected error";
  sendErr(res, 500, "INTERNAL", message);
}
