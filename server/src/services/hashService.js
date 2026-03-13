import crypto from "node:crypto";

const HASH_ALGORITHM = "sha256";
const DEFAULT_ITERATIONS = 210_000;

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

export const verifyPassword = ({ password, hash, salt, iterations }) => {
  const computed = crypto
    .pbkdf2Sync(password, salt, iterations, 32, HASH_ALGORITHM)
    .toString("base64url");

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(computed));
};

