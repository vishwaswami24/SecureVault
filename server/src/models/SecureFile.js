import mongoose from "mongoose";

const secureFileSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    encryptedSize: { type: Number, default: 0 },
    chunkSize: { type: Number, required: true },
    chunkCount: { type: Number, required: true },
    storageKey: { type: String, required: true },
    status: {
      type: String,
      enum: ["uploading", "ready", "rotation_required"],
      default: "uploading"
    },
    encryption: {
      algorithm: { type: String, default: "AES-GCM" },
      keyLength: { type: Number, default: 256 },
      baseIv: { type: String, required: true },
      keyVersion: { type: Number, default: 1 }
    },
    lastRotationRequiredAt: { type: Date, default: null }
  },
  { timestamps: true }
);

secureFileSchema.index({ ownerId: 1, createdAt: -1 });

export const SecureFile = mongoose.model("SecureFile", secureFileSchema);

