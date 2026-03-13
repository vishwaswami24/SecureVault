# SecureVault Encryption Concepts

This document explains the encryption design used in SecureVault, using the real code that already exists in the project.

The main goal is:

- encrypt file data in the browser before upload
- never store raw file keys on the backend
- allow secure sharing through wrapped keys
- keep access control and audit logic on the server

## 1. High-level model

SecureVault uses a hybrid encryption approach:

1. A random AES-256 file key is created in the browser for each uploaded file.
2. The file is split into chunks, and every chunk is encrypted with AES-GCM.
3. The backend stores only encrypted chunks plus metadata.
4. The AES file key is wrapped in different ways depending on who needs access.

The backend never stores the raw AES file key.

## 2. Why hybrid encryption is used

Asymmetric encryption is great for sharing secrets, but it is not ideal for encrypting large files directly.
Symmetric encryption is fast, so the project uses:

- `AES-256-GCM` for the file contents
- `ECDH + HKDF + AES-GCM` for sharing the file key to another user
- `PBKDF2 + AES-GCM` for password-based protection of private keys and link shares

This is the core design pattern behind the system.

## 3. Client-side file encryption

The browser generates a fresh AES-256 key for every uploaded file.

Project code:

```js
export const generateFileKey = async () =>
  crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256
    },
    true,
    ["encrypt", "decrypt"]
  );
```

Source:

- `client/src/crypto/fileCrypto.js`

Why this matters:

- every file gets a unique symmetric key
- encryption happens in the browser before any upload starts
- the server never receives the plaintext file

## 4. Chunked encryption for large files

Files are split into chunks so large uploads do not need one giant request.

Project code:

```js
const chunkSize = DEFAULT_CHUNK_SIZE;
const chunkCount = Math.ceil(selectedFile.size / chunkSize);

for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
  const start = chunkIndex * chunkSize;
  const end = Math.min(selectedFile.size, start + chunkSize);
  const chunk = await selectedFile.slice(start, end).arrayBuffer();
  const encryptedChunk = await encryptChunk(fileKey, chunk, baseIv, chunkIndex);

  await api.uploadChunk(session.token, initiated.uploadId, chunkIndex, encryptedChunk);
}
```

Source:

- `client/src/components/UploadPanel.jsx`

Why this matters:

- works better for large files
- keeps memory usage more controlled
- allows future retry/resume strategies per chunk

## 5. AES-GCM with derived chunk IVs

AES-GCM requires a unique IV for every encryption operation. Since a file is chunked, SecureVault derives a chunk-specific IV from a base IV.

Project code:

```js
export const createBaseIv = () => randomBase64(12);

export const deriveChunkIv = (baseIv, chunkIndex) => {
  const bytes = typeof baseIv === "string" ? fromBase64(baseIv) : new Uint8Array(baseIv);
  const iv = bytes.slice(0, 12);
  const view = new DataView(iv.buffer);

  view.setUint32(8, chunkIndex);
  return iv;
};
```

And actual encryption:

```js
export const encryptChunk = async (fileKey, chunk, baseIv, chunkIndex) =>
  crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: deriveChunkIv(baseIv, chunkIndex)
    },
    fileKey,
    chunk
  );
```

Source:

- `client/src/crypto/fileCrypto.js`

Why this matters:

- every chunk uses a different IV
- prevents dangerous IV reuse with AES-GCM
- keeps decryption deterministic because the same IV can be rebuilt later

## 6. Owner key wrapping with password

The owner must be able to decrypt the file later. Instead of sending the raw AES key to the backend, the browser wraps that file key using a password-derived AES key.

Project code:

```js
const derivePasswordKey = async (password, salt, usages) => {
  const passwordKey = await crypto.subtle.importKey("raw", encodeText(password), "PBKDF2", false, ["deriveKey"]);

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: PBKDF2_ITERATIONS
    },
    passwordKey,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    usages
  );
};
```

Wrapping the file key:

```js
export const wrapFileKeyForOwner = async (fileKey, password) => {
  const rawKey = await crypto.subtle.exportKey("raw", fileKey);
  const wrapped = await encryptBytesWithPassword(rawKey, password);

  return {
    mode: "owner-password",
    ...wrapped
  };
};
```

Source:

- `client/src/crypto/passwordEnvelope.js`

Why this matters:

- the backend stores only wrapped key material
- only someone with the correct password can unwrap the owner file key

## 7. User account ECDH key pair

Each registered user gets an ECDH key pair in the browser.

Project code:

```js
export const generateUserKeyBundle = async (password) => {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    true,
    ["deriveBits"]
  );

  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const encryptedPrivateKeyBundle = await encryptJsonWithPassword(privateKeyJwk, password);

  return {
    publicKeyJwk,
    encryptedPrivateKeyBundle
  };
};
```

Source:

- `client/src/crypto/accountCrypto.js`

Why this matters:

- the public key can be stored on the backend safely
- the private key is encrypted client-side before storage
- the backend never sees the private key in plaintext

## 8. Private key protection

The user's private ECDH key is encrypted with the account password before it is stored.

Project code:

```js
export const encryptJsonWithPassword = async (payload, password) => {
  const bytes = encodeText(JSON.stringify(payload));
  return encryptBytesWithPassword(bytes, password);
};
```

Unlocking it later:

```js
export const unlockPrivateKey = async (bundle, password) => {
  const privateKeyJwk = await decryptJsonWithPassword(bundle, password);

  return crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    true,
    ["deriveBits"]
  );
};
```

Sources:

- `client/src/crypto/passwordEnvelope.js`
- `client/src/crypto/accountCrypto.js`

Why this matters:

- protects the user's private sharing key
- keeps the platform closer to zero-knowledge behavior

## 9. ECDH sharing between users

When sharing a file to another registered user, the sender does not share the raw file key. Instead:

1. the sender imports the recipient's public key
2. the sender creates an ephemeral ECDH key pair
3. both sides can derive the same shared secret
4. HKDF turns that shared secret into an AES wrapping key
5. the file key is encrypted with that wrapping key

Project code:

```js
const sharedSecret = await crypto.subtle.deriveBits(
  {
    name: "ECDH",
    public: recipientPublicKey
  },
  ephemeralKeyPair.privateKey,
  256
);

const wrappingKey = await deriveWrappingKey({ sharedSecret, salt, usages: ["encrypt"] });
const rawFileKey = await crypto.subtle.exportKey("raw", fileKey);
const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrappingKey, rawFileKey);
```

Source:

- `client/src/crypto/shareCrypto.js`

Why HKDF is used:

- the raw ECDH shared secret should not be used directly as an encryption key
- HKDF produces a proper AES key from the shared secret

## 10. HKDF in the share flow

Project code:

```js
const deriveWrappingKey = async ({ sharedSecret, salt, usages }) => {
  const hkdfBase = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: SHARE_INFO
    },
    hkdfBase,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    usages
  );
};
```

Source:

- `client/src/crypto/shareCrypto.js`

Why this matters:

- binds the derived key to the app context through `SHARE_INFO`
- creates a clean symmetric wrapping key from the ECDH output

## 11. Password-protected share links

Not every recipient is a registered user. For that case, SecureVault also supports a link-based share.

Instead of ECDH:

- the file key is wrapped with a passphrase-derived AES key
- the backend stores only the wrapped package plus a hashed share token
- the recipient must know both the URL token and the passphrase

Project code:

```js
export const wrapFileKeyWithPassphrase = async (fileKey, passphrase) => {
  const rawKey = await crypto.subtle.exportKey("raw", fileKey);
  const wrapped = await encryptBytesWithPassword(rawKey, passphrase);

  return {
    mode: "link-password",
    ...wrapped
  };
};
```

Source:

- `client/src/crypto/passwordEnvelope.js`

## 12. Backend stores wrapped key packages, not raw keys

The central backend rule is that only wrapped key material is persisted.

Project code:

```js
const accessGrantSchema = new mongoose.Schema(
  {
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: "SecureFile", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    principalType: {
      type: String,
      enum: ["user", "link"],
      required: true
    },
    role: {
      type: String,
      enum: ["owner", "viewer"],
      required: true
    },
    grantType: {
      type: String,
      enum: ["owner-password", "ecdh", "link-password"],
      required: true
    },
    wrappedKeyPackage: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    }
  },
  { timestamps: true }
);
```

Source:

- `server/src/models/AccessGrant.js`

Why this matters:

- the server knows who can access what
- the server does not know the raw file key itself

## 13. Secure upload metadata created by the API

During upload initialization, the client sends encryption metadata, but not the plaintext file or raw key.

Project code:

```js
const initiated = await api.initiateUpload(session.token, {
  originalName: selectedFile.name,
  mimeType: selectedFile.type || "application/octet-stream",
  size: selectedFile.size,
  chunkSize,
  chunkCount,
  baseIv,
  ownerWrappedKeyPackage
});
```

Server receives and stores that metadata:

```js
const file = await SecureFile.create({
  ownerId: req.user.id,
  originalName,
  mimeType,
  size,
  chunkSize,
  chunkCount,
  storageKey: `file_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  encryption: {
    algorithm: "AES-GCM",
    keyLength: 256,
    baseIv,
    keyVersion: 1
  }
});
```

Sources:

- `client/src/components/UploadPanel.jsx`
- `server/src/controllers/fileController.js`

## 14. Decryption path on download

The decrypt flow depends on the type of access grant.

Project code:

```js
export const unwrapGrantFileKey = async ({ grant, password, privateKey, passphrase }) => {
  if (grant.grantType === "owner-password") {
    return unwrapFileKeyForOwner(grant.wrappedKeyPackage, password);
  }

  if (grant.grantType === "ecdh") {
    return unwrapEcdhSharePackage(grant.wrappedKeyPackage, privateKey);
  }

  if (grant.grantType === "link-password") {
    return unwrapFileKeyWithPassphrase(grant.wrappedKeyPackage, passphrase);
  }
};
```

Then chunk decryption happens one chunk at a time:

```js
const encryptedChunk = await api.getEncryptedChunk({
  token,
  shareToken,
  fileId: file.id,
  chunkIndex
});
const decryptedChunk = await decryptChunk(fileKey, encryptedChunk, file.encryption.baseIv, chunkIndex);
```

Source:

- `client/src/lib/fileAccess.js`

## 15. Password hashing for login is separate from file encryption

One important distinction:

- file encryption uses browser crypto and wrapped file keys
- login verification uses server-side password hashing

Project code:

```js
export const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto
    .pbkdf2Sync(password, salt, DEFAULT_ITERATIONS, 32, HASH_ALGORITHM)
    .toString("base64url");

  return {
    hash,
    salt,
    iterations: DEFAULT_ITERATIONS
  };
};
```

Source:

- `server/src/services/hashService.js`

Why this matters:

- the login password is not stored directly
- authentication hashing is separate from the owner-key wrapping flow

## 16. Access control and encryption work together

Encryption alone is not enough. The backend also checks authorization before returning encrypted chunks.

Project code:

```js
const grant = shareToken
  ? await findShareGrant({ shareToken })
  : await findUserGrant({ fileId, userId: req.user?.id });

if (!grant || grant.fileId.toString() !== fileId || !isGrantActive(grant)) {
  return res.status(403).json({ message: "Access denied for chunk request" });
}
```

Source:

- `server/src/controllers/fileController.js`

Why this matters:

- a user must have both the right wrapped key path and a valid ACL grant
- unauthorized users cannot even fetch encrypted chunks

## 17. Revocation and key rotation

Revocation in cryptographic systems has an important limitation:

- if someone already decrypted and saved the file key earlier, you cannot force them to forget it

What this project does:

1. revoke the backend access grant immediately
2. mark the file as `rotation_required`
3. increment the key version
4. require client-side re-encryption before future sharing

Project code:

```js
grant.revokedAt = new Date();
await grant.save();

const file = await SecureFile.findById(fileId);
file.status = "rotation_required";
file.lastRotationRequiredAt = new Date();
file.encryption.keyVersion += 1;
await file.save();
```

Source:

- `server/src/controllers/fileController.js`

This is an honest and realistic approach. It does not pretend revocation is magically perfect after a key was already exposed to a recipient.

## 18. Why this design is close to zero-knowledge

The platform is close to zero-knowledge because:

- file bytes are encrypted before upload
- the server stores only encrypted chunks
- the server stores only wrapped key packages
- private ECDH keys are encrypted before persistence
- decryption happens in the browser

The backend still knows metadata, ACLs, and audit events, but it does not hold the raw secrets needed to read the file contents.

## 19. Summary of algorithms used

- `AES-256-GCM`
  - encrypting file chunks
  - wrapping file keys with password-derived or HKDF-derived keys

- `PBKDF2-SHA256`
  - deriving AES keys from passwords or passphrases
  - hashing login passwords server-side

- `ECDH P-256`
  - secure sharing of a file key between registered users

- `HKDF-SHA256`
  - deriving a proper wrapping key from the ECDH shared secret

## 20. File map for quick review

- `client/src/crypto/fileCrypto.js`
- `client/src/crypto/passwordEnvelope.js`
- `client/src/crypto/accountCrypto.js`
- `client/src/crypto/shareCrypto.js`
- `client/src/components/UploadPanel.jsx`
- `client/src/lib/fileAccess.js`
- `server/src/models/AccessGrant.js`
- `server/src/services/hashService.js`
- `server/src/controllers/fileController.js`

