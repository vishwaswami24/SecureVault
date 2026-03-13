import { AccessGrant } from "../models/AccessGrant.js";
import { AuditEvent } from "../models/AuditEvent.js";

export const getAuditTrail = async (req, res) => {
  const ownerGrant = await AccessGrant.findOne({
    fileId: req.params.fileId,
    userId: req.user.id,
    role: "owner",
    revokedAt: null
  }).lean();

  if (!ownerGrant) {
    return res.status(403).json({ message: "Only the owner can review audit logs" });
  }

  const events = await AuditEvent.find({ fileId: req.params.fileId }).sort({ createdAt: -1 }).lean();

  res.json({
    events: events.map((event) => ({
      id: event._id.toString(),
      action: event.action,
      actorEmail: event.actorEmail,
      createdAt: event.createdAt,
      details: event.details,
      ip: event.ip,
      userAgent: event.userAgent
    }))
  });
};
