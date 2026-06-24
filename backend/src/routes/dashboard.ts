import { Router } from "express";
import { asyncHandler, sendOk, param } from "../utils/http.js";
import { fail } from "../utils/errors.js";
import type { Role } from "../types/domain.js";
import { dashboardService } from "../services/dashboardService.js";

export const dashboardRouter = Router();

dashboardRouter.get(
  "/summary",
  asyncHandler(async (_req, res) => {
    sendOk(res, await dashboardService.summary());
  }),
);

const ROLES: Role[] = ["compliance", "it", "cxo", "auditor"];

dashboardRouter.get(
  "/review-queue",
  asyncHandler(async (_req, res) => {
    sendOk(res, await dashboardService.reviewQueue());
  }),
);

dashboardRouter.get(
  "/circular-status",
  asyncHandler(async (_req, res) => {
    sendOk(res, await dashboardService.circularStatuses());
  }),
);

dashboardRouter.get(
  "/role/:role",
  asyncHandler(async (req, res) => {
    const role = param(req, "role") as Role;
    if (!ROLES.includes(role)) throw fail("BAD_REQUEST", `Unknown role ${role}`);
    sendOk(res, await dashboardService.roleWorkspace(role));
  }),
);
