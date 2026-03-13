import crypto from "node:crypto";
import { env } from "../config/env.js";

const encode = (value) => Buffer.from(value).toString("base64url");
const decodeJson = (value) => JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

export const signToken = (payload) => {
  const now = Math.floor(Date.now() / 1000);
  const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = encode(
    JSON.stringify({
      ...payload,
      iat: now,
      exp: now + env.jwtTtlSeconds
    })
  );
  const signature = crypto.createHmac("sha256", env.jwtSecret).update(`${header}.${body}`).digest("base64url");

  return `${header}.${body}.${signature}`;
};

export const verifyToken = (token) => {
  const [header, body, signature] = token.split(".");

  if (!header || !body || !signature) {
    throw new Error("Malformed token");
  }

  const expected = crypto.createHmac("sha256", env.jwtSecret).update(`${header}.${body}`).digest("base64url");

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error("Invalid token signature");
  }

  const payload = decodeJson(body);
  const now = Math.floor(Date.now() / 1000);

  if (!payload.exp || payload.exp < now) {
    throw new Error("Token expired");
  }

  return payload;
};

export const hashOpaqueToken = (token) =>
  crypto.createHash("sha256").update(token).digest("base64url");

export const createOpaqueToken = () => crypto.randomBytes(32).toString("base64url");

