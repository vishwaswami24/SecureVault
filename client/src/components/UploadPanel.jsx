import { useState } from "react";
import { api } from "../api/client.js";
import { DEFAULT_CHUNK_SIZE, createBaseIv, encryptChunk, generateFileKey } from "../crypto/fileCrypto.js";
import { wrapFileKeyForOwner } from "../crypto/passwordEnvelope.js";

export const UploadPanel = ({ session, onUploaded }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [status, setStatus] = useState({ loading: false, message: "" });
  const [isDragging, setIsDragging] = useState(false);

  const upload = async () => {
    if (!selectedFile) {
      return;
    }

    setStatus({ loading: true, message: "Generating AES-256 file key..." });

    try {
      const chunkSize = DEFAULT_CHUNK_SIZE;
      const chunkCount = Math.ceil(selectedFile.size / chunkSize);
      const fileKey = await generateFileKey();
      const baseIv = createBaseIv();
      const ownerWrappedKeyPackage = await wrapFileKeyForOwner(fileKey, session.password);
      const initiated = await api.initiateUpload(session.token, {
        originalName: selectedFile.name,
        mimeType: selectedFile.type || "application/octet-stream",
        size: selectedFile.size,
        chunkSize,
        chunkCount,
        baseIv,
        ownerWrappedKeyPackage
      });

      for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
        const start = chunkIndex * chunkSize;
        const end = Math.min(selectedFile.size, start + chunkSize);
        const chunk = await selectedFile.slice(start, end).arrayBuffer();
        const encryptedChunk = await encryptChunk(fileKey, chunk, baseIv, chunkIndex);

        setStatus({
          loading: true,
          message: `Encrypting and uploading chunk ${chunkIndex + 1} of ${chunkCount}`
        });

        await api.uploadChunk(session.token, initiated.uploadId, chunkIndex, encryptedChunk);
      }

      await api.completeUpload(session.token, initiated.uploadId);
      setSelectedFile(null);
      setStatus({ loading: false, message: "Upload complete." });
      onUploaded();
    } catch (error) {
      setStatus({ loading: false, message: error.message });
    }
  };

  return (
    <section className="card">
      <div className="section-head">
        <div>
          <h2>Encrypt and Upload</h2>
          <p className="muted">Chunks are AES-GCM encrypted in-browser before the first network request is made.</p>
        </div>
      </div>

      <div className="upload-facts">
        <div className="fact-chip">
          <strong>AES-256-GCM</strong>
          <span>per-file encryption key</span>
        </div>
        <div className="fact-chip">
          <strong>4 MB</strong>
          <span>default chunk size</span>
        </div>
        <div className="fact-chip">
          <strong>Zero plaintext</strong>
          <span>before transfer</span>
        </div>
      </div>

      <label className="drop-zone">
        <input
          type="file"
          hidden
          onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
        />
        <div
          className={isDragging ? "drop-zone-frame active" : "drop-zone-frame"}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setIsDragging(false);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) {
              setSelectedFile(file);
            }
          }}
          role="presentation"
        >
          <span>{selectedFile ? selectedFile.name : "Drop a file here or click to browse"}</span>
          <small>{selectedFile ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB selected` : "Target chunk size: 4 MB"}</small>
        </div>
      </label>

      <div className="actions">
        <button className="primary" disabled={!selectedFile || status.loading} onClick={upload} type="button">
          {status.loading ? "Uploading..." : "Start secure upload"}
        </button>
      </div>

      {selectedFile ? (
        <div className="selected-file-card">
          <strong>{selectedFile.name}</strong>
          <span>{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB queued for encryption</span>
        </div>
      ) : null}

      {status.message ? <p className="muted">{status.message}</p> : null}
    </section>
  );
};
