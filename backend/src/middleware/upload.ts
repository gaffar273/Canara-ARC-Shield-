import multer from "multer";
import { config } from "../config/index.js";

/** In-memory upload: intake hashes and stores the buffer itself (no temp files). */
export const uploadSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.maxBytes },
}).single("file");
