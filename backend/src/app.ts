import express from "express";
import cors from "cors";
import { identify } from "./middleware/auth.js";
import { notFound, errorHandler } from "./middleware/error.js";
import { apiRouter } from "./routes/index.js";

export function createApp(): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(identify);

  app.use("/api", apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
