import { encodeText, fromBase64, randomBase64, toBase64 } from "../lib/encoding";

const SHARE_INFO = encodeText("SecureVault-ECDH-Share");

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

export const createEcdhSharePackage = async (fileKey, recipientPublicKeyJwk) => {
  const recipientPublicKey = await crypto.subtle.importKey(
    "jwk",
    recipientPublicKeyJwk,
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    true,
    []
  );

  const ephemeralKeyPair = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    true,
    ["deriveBits"]
  );

  const sharedSecret = await crypto.subtle.deriveBits(
    {
      name: "ECDH",
      public: recipientPublicKey
    },
    ephemeralKeyPair.privateKey,
    256
  );

  const salt = fromBase64(randomBase64(16));
  const iv = fromBase64(randomBase64(12));
  const wrappingKey = await deriveWrappingKey({ sharedSecret, salt, usages: ["encrypt"] });
  const rawFileKey = await crypto.subtle.exportKey("raw", fileKey);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrappingKey, rawFileKey);
  const ephemeralPublicKeyJwk = await crypto.subtle.exportKey("jwk", ephemeralKeyPair.publicKey);

  return {
    mode: "ecdh",
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
    ephemeralPublicKeyJwk
  };
};

export const unwrapEcdhSharePackage = async (sharePackage, recipientPrivateKey) => {
  const ephemeralPublicKey = await crypto.subtle.importKey(
    "jwk",
    sharePackage.ephemeralPublicKeyJwk,
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    true,
    []
  );

  const sharedSecret = await crypto.subtle.deriveBits(
    {
      name: "ECDH",
      public: ephemeralPublicKey
    },
    recipientPrivateKey,
    256
  );

  const wrappingKey = await deriveWrappingKey({
    sharedSecret,
    salt: fromBase64(sharePackage.salt),
    usages: ["decrypt"]
  });

  const rawFileKey = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64(sharePackage.iv)
    },
    wrappingKey,
    fromBase64(sharePackage.ciphertext)
  );

  return crypto.subtle.importKey("raw", rawFileKey, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
};

