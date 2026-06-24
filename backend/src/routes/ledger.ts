import { Router } from "express";
import { asyncHandler, sendOk, param } from "../utils/http.js";
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
  "/custody/:refId",
  asyncHandler(async (req, res) => {
    sendOk(res, await ledgerService.chainOfCustody(param(req, "refId")));
  }),
);
