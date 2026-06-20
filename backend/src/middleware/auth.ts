import type { Request, Response, NextFunction } from "express";
import type { Role } from "../types/domain.js";
import { fail } from "../utils/errors.js";

const ROLES: Role[] = ["compliance", "it", "cxo", "auditor"];

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      role?: Role;
    }
  }
}

function parseRole(value: unknown): Role | null {
  return typeof value === "string" && (ROLES as string[]).includes(value)
    ? (value as Role)
    : null;
}

/** Resolves the caller role from the x-role header onto the request. */
export function identify(req: Request, _res: Response, next: NextFunction): void {
  const role = parseRole(req.header("x-role"));
  if (role) req.role = role;
  next();
}

/** Guards a route to the given roles. Auditor is read-only by convention. */
export function requireRole(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.role) {
      next(fail("UNAUTHORIZED", "Missing or invalid x-role header"));
      return;
    }
    if (!allowed.includes(req.role)) {
      next(fail("FORBIDDEN", `Role ${req.role} not permitted here`));
      return;
    }
    next();
  };
}
