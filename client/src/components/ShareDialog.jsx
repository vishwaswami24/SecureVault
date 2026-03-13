import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { wrapFileKeyWithPassphrase, unwrapFileKeyForOwner } from "../crypto/passwordEnvelope.js";
import { createEcdhSharePackage } from "../crypto/shareCrypto.js";

export const ShareDialog = ({ file, session, onClose }) => {
  const [mode, setMode] = useState("user");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [directoryResults, setDirectoryResults] = useState([]);
  const [selectedRecipient, setSelectedRecipient] = useState(null);
  const [passphrase, setPassphrase] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [status, setStatus] = useState("");
  const [grants, setGrants] = useState([]);

  const selectedRecipientEmail = useMemo(
    () => selectedRecipient?.email || recipientEmail,
    [recipientEmail, selectedRecipient]
  );

  const resolveOwnerFileKey = () => unwrapFileKeyForOwner(file.access.wrappedKeyPackage, session.password);

  useEffect(() => {
    const loadGrants = async () => {
      try {
        const response = await api.listAccessGrants(session.token, file.id);
        setGrants(response.grants);
      } catch (error) {
        setStatus(error.message);
      }
    };

    loadGrants();
  }, [file.id, session.token]);

  const searchUsers = async () => {
    try {
      const response = await api.searchDirectory(session.token, recipientEmail);
      setDirectoryResults(response.users);
      setStatus("");
    } catch (error) {
      setStatus(error.message);
    }
  };

  const shareWithUser = async () => {
    try {
      if (!selectedRecipient) {
        throw new Error("Select a registered recipient first.");
      }

      setStatus("Creating ECDH share package...");
      const fileKey = await resolveOwnerFileKey();
      const wrappedKeyPackage = await createEcdhSharePackage(fileKey, selectedRecipient.publicKeyJwk);
      await api.createUserShare(session.token, file.id, {
        recipientEmail: selectedRecipient.email,
        wrappedKeyPackage,
        expiresAt: expiresAt || null
      });
      const refreshed = await api.listAccessGrants(session.token, file.id);
      setGrants(refreshed.grants);
      setStatus(`Shared securely with ${selectedRecipient.email}.`);
    } catch (error) {
      setStatus(error.message);
    }
  };

  const shareWithLink = async () => {
    try {
      if (!passphrase) {
        throw new Error("Add a passphrase for the secure link.");
      }

      setStatus("Wrapping file key into password-protected link...");
      const fileKey = await resolveOwnerFileKey();
      const wrappedKeyPackage = await wrapFileKeyWithPassphrase(fileKey, passphrase);
      const shareToken = crypto.randomUUID();
      const response = await api.createLinkShare(session.token, file.id, {
        wrappedKeyPackage,
        expiresAt: expiresAt || null,
        shareToken,
        shareUrlBase: window.location.origin
      });
      const refreshed = await api.listAccessGrants(session.token, file.id);
      setGrants(refreshed.grants);
      setStatus(`Share link ready: ${response.share.url}`);
    } catch (error) {
      setStatus(error.message);
    }
  };

  const revokeGrant = async (grantId) => {
    try {
      setStatus("Revoking access and flagging key rotation...");
      await api.revokeGrant(session.token, file.id, grantId);
      const refreshed = await api.listAccessGrants(session.token, file.id);
      setGrants(refreshed.grants);
      setStatus("Access revoked. Re-encrypt the file with a fresh key before redistributing.");
    } catch (error) {
      setStatus(error.message);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal card">
        <div className="section-head">
          <div>
            <h2>Share {file.originalName}</h2>
            <p className="muted">The backend only stores wrapped key material and ACL metadata.</p>
          </div>
          <button onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="share-summary">
          <span className="meta-pill">{file.chunkCount} chunks</span>
          <span className="meta-pill">{file.access.role}</span>
          <span className={file.status === "rotation_required" ? "status-pill warning-pill" : "status-pill"}>
            {file.status === "rotation_required" ? "Rotation required" : "Ready to share"}
          </span>
        </div>

        <div className="segmented">
          <button className={mode === "user" ? "active" : ""} onClick={() => setMode("user")} type="button">
            Registered user
          </button>
          <button className={mode === "link" ? "active" : ""} onClick={() => setMode("link")} type="button">
            Password link
          </button>
        </div>

        <label className="field">
          <span>Expires at</span>
          <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
        </label>

        {file.status === "rotation_required" ? (
          <p className="warning">
            This file cannot be reshared until it is re-encrypted with a fresh AES key version.
          </p>
        ) : null}

        {mode === "user" ? (
          <div className="stack">
            <label className="field">
              <span>Recipient email</span>
              <input value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} />
            </label>
            <div className="button-row">
              <button onClick={searchUsers} type="button">
                Search directory
              </button>
              <button className="primary" disabled={file.status === "rotation_required"} onClick={shareWithUser} type="button">
                Share with selected user
              </button>
            </div>
            {directoryResults.length ? (
              <div className="result-list">
                {directoryResults.map((user) => (
                  <button
                    className={selectedRecipientEmail === user.email ? "result active" : "result"}
                    key={user.id}
                    onClick={() => setSelectedRecipient(user)}
                    type="button"
                  >
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="stack">
            <label className="field">
              <span>Link passphrase</span>
              <input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} />
            </label>
            <button className="primary" disabled={file.status === "rotation_required"} onClick={shareWithLink} type="button">
              Create password-protected link
            </button>
          </div>
        )}

        {status ? <p className="muted">{status}</p> : null}

        <div className="stack grant-list-block">
          <h3>Current grants</h3>
          {grants.length === 0 ? (
            <p className="muted">No viewer grants have been created yet.</p>
          ) : (
            grants.map((grant) => (
              <div className="grant-row" key={grant.id}>
                <div>
                  <strong>{grant.recipientEmail || "Password link"}</strong>
                  <p className="muted">
                    {grant.grantType} {grant.revokedAt ? "- revoked" : "- active"}
                  </p>
                </div>
                {!grant.revokedAt ? (
                  <button onClick={() => revokeGrant(grant.id)} type="button">
                    Revoke
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
