const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api";

const request = async (path, { method = "GET", token, body, headers = {}, responseType = "json" } = {}) => {
  const finalHeaders = { ...headers };

  if (token) {
    finalHeaders.Authorization = `Bearer ${token}`;
  }

  let payload = body;

  if (body && !(body instanceof ArrayBuffer) && !(body instanceof Uint8Array) && !finalHeaders["Content-Type"]) {
    finalHeaders["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: finalHeaders,
    body: payload
  });

  if (!response.ok) {
    let message = "Request failed";

    try {
      const errorPayload = await response.json();
      message = errorPayload.message || message;
    } catch {
      message = response.statusText || message;
    }

    throw new Error(message);
  }

  if (responseType === "arrayBuffer") {
    return response.arrayBuffer();
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};

export const api = {
  register: (payload) => request("/auth/register", { method: "POST", body: payload }),
  login: (payload) => request("/auth/login", { method: "POST", body: payload }),
  searchDirectory: (token, query) =>
    request(`/auth/directory?query=${encodeURIComponent(query)}`, { token }),
  initiateUpload: (token, payload) => request("/files/initiate", { method: "POST", token, body: payload }),
  uploadChunk: (token, uploadId, chunkIndex, chunkBuffer) =>
    request(`/files/uploads/${uploadId}/chunks/${chunkIndex}`, {
      method: "PUT",
      token,
      headers: { "Content-Type": "application/octet-stream" },
      body: chunkBuffer
    }),
  completeUpload: (token, uploadId) =>
    request(`/files/uploads/${uploadId}/complete`, {
      method: "POST",
      token
    }),
  listFiles: (token) => request("/files", { token }),
  getFileManifest: (token, fileId) => request(`/files/${fileId}`, { token }),
  getEncryptedChunk: ({ token, fileId, chunkIndex, shareToken }) =>
    request(`/files/${fileId}/chunks/${chunkIndex}`, {
      token,
      headers: shareToken ? { "x-share-token": shareToken } : {},
      responseType: "arrayBuffer"
    }),
  createUserShare: (token, fileId, payload) =>
    request(`/files/${fileId}/share/user`, {
      method: "POST",
      token,
      body: payload
    }),
  createLinkShare: (token, fileId, payload) =>
    request(`/files/${fileId}/share/link`, {
      method: "POST",
      token,
      body: payload
    }),
  listAccessGrants: (token, fileId) => request(`/files/${fileId}/access`, { token }),
  resolveShare: (shareToken) => request(`/files/shares/${shareToken}`),
  getAuditTrail: (token, fileId) => request(`/audit/${fileId}`, { token }),
  revokeGrant: (token, fileId, grantId) =>
    request(`/files/${fileId}/access/${grantId}`, {
      method: "DELETE",
      token
    }),
  deleteFile: (token, fileId) =>
    request(`/files/${fileId}`, {
      method: "DELETE",
      token
    })
};
