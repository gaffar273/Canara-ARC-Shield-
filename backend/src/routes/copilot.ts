import { Router } from "express";
import { asyncHandler, sendOk } from "../utils/http.js";
import { fail } from "../utils/errors.js";
import { copilotService } from "../services/copilotService.js";

export const copilotRouter = Router();

copilotRouter.post(
  "/ask",
  asyncHandler(async (req, res) => {
    const query = (req.body as { query?: unknown }).query;
    if (typeof query !== "string" || query.trim().length === 0) {
      throw fail("BAD_REQUEST", "Body must include a non-empty 'query' string");
    }
    sendOk(res, await copilotService.ask(query));
  }),
);
