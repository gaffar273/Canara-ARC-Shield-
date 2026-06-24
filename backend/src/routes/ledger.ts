import { Router } from "express";
import { asyncHandler, sendOk, param } from "../utils/http.js";
import { fail } from "../utils/errors.js";
import { requireRole } from "../middleware/auth.js";
import { ledgerService } from "../services/ledgerService.js";

export const ledgerRouter = Router();

ledgerRouter.get(
  "/chain",
  asyncHandler(async (_req, res) => {
    sendOk(res, await ledgerService.fullChain());
  }),
);

ledgerRouter.get(
  "/verify",
  asyncHandler(async (_req, res) => {
    sendOk(res, await ledgerService.verifyIntegrity());
  }),
);

ledgerRouter.get(
  "/network",
  asyncHandler(async (_req, res) => {
    sendOk(res, ledgerService.network());
  }),
);

ledgerRouter.get(
  "/agents",
  asyncHandler(async (_req, res) => {
    sendOk(res, await ledgerService.agents());
  }),
);

ledgerRouter.post(
  "/agents/register",
  requireRole("cxo"),
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { id?: unknown; role?: unknown; allowedKinds?: unknown };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const role = typeof body.role === "string" ? body.role.trim() : "";
    if (!id || !role) throw fail("BAD_REQUEST", "id and role are required");
    const allowedKinds = Array.isArray(body.allowedKinds)
      ? body.allowedKinds.filter((k): k is string => typeof k === "string")
      : [];
    sendOk(res, await ledgerService.registerAgent(id, role, allowedKinds), 201);
  }),
);

ledgerRouter.get(
  "/custody/:refId",
  asyncHandler(async (req, res) => {
    sendOk(res, await ledgerService.chainOfCustody(param(req, "refId")));
  }),
);
