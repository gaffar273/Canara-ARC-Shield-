import { Router } from "express";
import { asyncHandler, sendOk, param } from "../utils/http.js";
import { fail } from "../utils/errors.js";
import { requireRole } from "../middleware/auth.js";
import { uploadSingle } from "../middleware/upload.js";
import { intakeService } from "../services/intakeService.js";
import { orchestrator } from "../services/orchestrator.js";
import { reviewService } from "../services/reviewService.js";
import { dashboardService } from "../services/dashboardService.js";
import { stateStore } from "../store/stateStore.js";
import type { DecisionStatus, Role } from "../types/domain.js";

export const circularsRouter = Router();

const DECISION_STATUSES: DecisionStatus[] = ["APPROVED", "REJECTED", "REASSIGNED"];

circularsRouter.post(
  "/",
  requireRole("compliance"),
  uploadSingle,
  asyncHandler(async (req, res) => {
    if (!req.file) throw fail("BAD_REQUEST", "Missing file field 'file'");
    const circular = await intakeService.ingest({
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer,
    });
    sendOk(res, circular, 201);
  }),
);

circularsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    sendOk(res, await stateStore.listCirculars());
  }),
);

circularsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = param(req, "id");
    const circular = await stateStore.getCircular(id);
    if (!circular) throw fail("NOT_FOUND", `Unknown circular ${id}`);
    sendOk(res, circular);
  }),
);

circularsRouter.delete(
  "/:id",
  requireRole("compliance"),
  asyncHandler(async (req, res) => {
    const id = param(req, "id");
    await intakeService.remove(id);
    dashboardService.invalidate();
    sendOk(res, { circularId: id, deleted: true });
  }),
);

circularsRouter.post(
  "/:id/process",
  requireRole("compliance"),
  asyncHandler(async (req, res) => {
    const id = param(req, "id");
    await orchestrator.start(id);
    sendOk(res, { circularId: id, started: true }, 202);
  }),
);

circularsRouter.get(
  "/:id/references",
  asyncHandler(async (req, res) => {
    sendOk(res, await stateStore.referenceGraph(param(req, "id")));
  }),
);

circularsRouter.get(
  "/:id/pipeline",
  asyncHandler(async (req, res) => {
    sendOk(res, await orchestrator.status(param(req, "id")));
  }),
);

circularsRouter.post(
  "/:id/maps/:mapId/decision",
  requireRole("compliance"),
  asyncHandler(async (req, res) => {
    const circularId = param(req, "id");
    const mapId = param(req, "mapId");
    const body = (req.body ?? {}) as {
      status?: unknown;
      note?: unknown;
      reassignedTo?: unknown;
    };
    const status = body.status as DecisionStatus;
    if (!DECISION_STATUSES.includes(status)) {
      throw fail("BAD_REQUEST", `status must be one of ${DECISION_STATUSES.join(", ")}`);
    }
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!note) throw fail("BAD_REQUEST", "A decision note is required");

    const map = await reviewService.decide(circularId, mapId, {
      status,
      note,
      decidedBy: req.role as Role,
      reassignedTo: (body.reassignedTo as Role | undefined) ?? null,
    });
    sendOk(res, map);
  }),
);
