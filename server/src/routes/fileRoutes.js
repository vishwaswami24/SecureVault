import express, { Router } from "express";
import {
  deleteFile,
  completeUpload,
  createLinkShare,
  createUserShare,
  getFileChunk,
  getFileManifest,
  initiateUpload,
  listAccessGrants,
  listFiles,
  resolveShare,
  revokeGrant,
  uploadChunk
} from "../controllers/fileController.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";

const router = Router();
const rawChunkParser = express.raw({ type: "application/octet-stream", limit: "16mb" });

router.get("/", requireAuth, listFiles);
router.post("/initiate", requireAuth, initiateUpload);
router.put("/uploads/:uploadId/chunks/:chunkIndex", requireAuth, rawChunkParser, uploadChunk);
router.post("/uploads/:uploadId/complete", requireAuth, completeUpload);
router.get("/shares/:shareToken", resolveShare);
router.get("/:fileId/access", requireAuth, listAccessGrants);
router.get("/:fileId", requireAuth, getFileManifest);
router.get("/:fileId/chunks/:chunkIndex", optionalAuth, getFileChunk);
router.post("/:fileId/share/user", requireAuth, createUserShare);
router.post("/:fileId/share/link", requireAuth, createLinkShare);
router.delete("/:fileId/access/:grantId", requireAuth, revokeGrant);
router.delete("/:fileId", requireAuth, deleteFile);

export default router;
