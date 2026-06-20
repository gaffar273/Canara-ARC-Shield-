import { Router } from "express";
import { asyncHandler, sendOk, param } from "../utils/http.js";
import { fail } from "../utils/errors.js";
import { requireRole } from "../middleware/auth.js";
import { uploadSingle } from "../middleware/upload.js";
import { intakeService } from "../services/intakeService.js";
import { orchestrator } from "../services/orchestrator.js";
import { stateStore } from "../store/stateStore.js";

export const circularsRouter = Router();

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
  "/:id/pipeline",
  asyncHandler(async (req, res) => {
    sendOk(res, await orchestrator.status(param(req, "id")));
  }),
);
