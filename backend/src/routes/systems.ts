import { Router } from "express";
import { asyncHandler, sendOk, param } from "../utils/http.js";
import { fail } from "../utils/errors.js";
import { requireRole } from "../middleware/auth.js";
import { coreSystems } from "../adapters/coreSystems.js";

export const systemsRouter = Router();

systemsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    sendOk(res, await coreSystems.all());
  }),
);

systemsRouter.put(
  "/:department/:parameter",
  requireRole("it", "cxo"),
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { value?: unknown };
    if (!("value" in body)) throw fail("BAD_REQUEST", "Body must include 'value'");
    const updated = await coreSystems.update(
      param(req, "department"),
      param(req, "parameter"),
      body.value,
    );
    sendOk(res, updated);
  }),
);
