const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const encodeText = (value) => textEncoder.encode(value);
export const decodeText = (value) => textDecoder.decode(value);

export const toBase64 = (value) => {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
};

export const fromBase64 = (value) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

export const randomBase64 = (length) => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return toBase64(bytes);
};

