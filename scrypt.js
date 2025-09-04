// Minimal scrypt implementation adapted from scrypt-js (MIT License)
// https://github.com/ricmoo/scrypt-js
// This module exposes a single async function `scrypt` that derives a key of
// length `dkLen` bytes from `password` and `salt` using the provided
// parameters N, r, and p.

export async function scrypt(password, salt, { N, r, p, dkLen }) {
  if (!(password instanceof Uint8Array)) password = new Uint8Array(password);
  if (!(salt instanceof Uint8Array)) salt = new Uint8Array(salt);
  if (!Number.isInteger(N) || N <= 1 || (N & (N - 1)) !== 0) throw new Error('N must be power of two');
  if (r <= 0 || p <= 0) throw new Error('Invalid r or p');
  const blockSize = 128 * r;
  const PBKDF2 = async (pwd, slt, len) => {
    const key = await crypto.subtle.importKey('raw', pwd, 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: slt, iterations: 1, hash: 'SHA-256' }, key, len * 8);
    return new Uint8Array(bits);
  };
  let B = await PBKDF2(password, salt, p * blockSize);
  const V = new Uint32Array(N * (32 * r));
  const XY = new Uint32Array(64 * r);
  const blockMix = (B32) => {
    let X = B32.slice((2 * r - 1) * 16, 2 * r * 16);
    const Y = new Uint32Array(32 * r);
    for (let i = 0; i < 2 * r; i++) {
      for (let j = 0; j < 16; j++) X[j] ^= B32[i * 16 + j];
      salsa20_8(X);
      for (let j = 0; j < 16; j++) Y[i * 16 + j] = X[j];
    }
    for (let i = 0; i < r; i++) {
      for (let j = 0; j < 16; j++) B32[i * 16 + j] = Y[2 * i * 16 + j];
      for (let j = 0; j < 16; j++) B32[(i + r) * 16 + j] = Y[(2 * i + 1) * 16 + j];
    }
  };
  const ROMix = (Bslice) => {
    XY.set(Bslice);
    for (let i = 0; i < N; i++) {
      V.set(XY, i * XY.length);
      blockMix(XY);
    }
    for (let i = 0; i < N; i++) {
      const j = XY[(2 * r - 1) * 16] & (N - 1);
      for (let k = 0; k < XY.length; k++) XY[k] ^= V[j * XY.length + k];
      blockMix(XY);
    }
    Bslice.set(XY);
  };
  for (let i = 0; i < p; i++) {
    const Bi = B.subarray(i * blockSize, (i + 1) * blockSize);
    ROMix(new Uint32Array(Bi.buffer, Bi.byteOffset, Bi.byteLength / 4));
  }
  B = await PBKDF2(password, B, dkLen);
  return B;
}

function R(a, b) { return (a << b) | (a >>> (32 - b)); }
function salsa20_8(B) {
  let x = B.slice();
  for (let i = 0; i < 8; i += 2) {
    x[4] ^= R(x[0] + x[12], 7); x[8] ^= R(x[4] + x[0], 9);
    x[12] ^= R(x[8] + x[4], 13); x[0] ^= R(x[12] + x[8], 18);
    x[9] ^= R(x[5] + x[1], 7); x[13] ^= R(x[9] + x[5], 9);
    x[1] ^= R(x[13] + x[9], 13); x[5] ^= R(x[1] + x[13], 18);
    x[14] ^= R(x[10] + x[6], 7); x[2] ^= R(x[14] + x[10], 9);
    x[6] ^= R(x[2] + x[14], 13); x[10] ^= R(x[6] + x[2], 18);
    x[3] ^= R(x[15] + x[11], 7); x[7] ^= R(x[3] + x[15], 9);
    x[11] ^= R(x[7] + x[3], 13); x[15] ^= R(x[11] + x[7], 18);
    x[1] ^= R(x[0] + x[3], 7); x[2] ^= R(x[1] + x[0], 9);
    x[3] ^= R(x[2] + x[1], 13); x[0] ^= R(x[3] + x[2], 18);
    x[6] ^= R(x[5] + x[4], 7); x[7] ^= R(x[6] + x[5], 9);
    x[4] ^= R(x[7] + x[6], 13); x[5] ^= R(x[4] + x[7], 18);
    x[11] ^= R(x[10] + x[9], 7); x[8] ^= R(x[11] + x[10], 9);
    x[9] ^= R(x[8] + x[11], 13); x[10] ^= R(x[9] + x[8], 18);
    x[12] ^= R(x[15] + x[14], 7); x[13] ^= R(x[12] + x[15], 9);
    x[14] ^= R(x[13] + x[12], 13); x[15] ^= R(x[14] + x[13], 18);
  }
  for (let i = 0; i < 16; i++) B[i] = (B[i] + x[i]) >>> 0;
}
