import { Router } from "express";
import { sendOk } from "../utils/http.js";
import { circularsRouter } from "./circulars.js";
import { dashboardRouter } from "./dashboard.js";
import { ledgerRouter } from "./ledger.js";
import { copilotRouter } from "./copilot.js";

export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  sendOk(res, { status: "ok", service: "arc-shield-backend" });
});

apiRouter.use("/circulars", circularsRouter);
apiRouter.use("/dashboard", dashboardRouter);
apiRouter.use("/ledger", ledgerRouter);
apiRouter.use("/copilot", copilotRouter);
