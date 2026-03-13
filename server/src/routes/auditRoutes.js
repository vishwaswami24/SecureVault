import { Router } from "express";
import { getAuditTrail } from "../controllers/auditController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/:fileId", requireAuth, getAuditTrail);

export default router;

