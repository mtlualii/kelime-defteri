// Verifies the Web Push pipeline without a push service: builds a payload exactly as the Worker does,
// then decrypts it as a browser would (RFC 8291 / RFC 8188) and checks the VAPID JWT signature.
import { buildPushPayload } from '@block65/webcrypto-web-push';
import assert from 'node:assert/strict';

const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const fromB64u = (s) => new Uint8Array(Buffer.from(s, 'base64url'));

// --- server side: VAPID keys the way Store.getVapid() makes them
const vk = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const vapidPub = b64u(new Uint8Array(await crypto.subtle.exportKey('raw', vk.publicKey)));
const vapidPriv = (await crypto.subtle.exportKey('jwk', vk.privateKey)).d;

// --- client side: a browser subscription (ECDH key + 16-byte auth secret)
const ck = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const clientPub = new Uint8Array(await crypto.subtle.exportKey('raw', ck.publicKey));
const authSecret = crypto.getRandomValues(new Uint8Array(16));
const subscription = { endpoint: 'https://web.push.apple.com/QW1lcmljYS9Mb3NfQW5nZWxlcw', expirationTime: null, keys: { p256dh: b64u(clientPub), auth: b64u(authSecret) } };

const message = { title: 'Kelime Defteri', body: 'Günaydın! Bugün tekrar edilecek 6 kelimen var: ممرّ (memer), عتاب (itab), congregation…', url: '/#tekrar', tag: 'kd-2026-11-09' };
const payload = await buildPushPayload({ data: message, options: { ttl: 21600, urgency: 'normal' } }, subscription, { subject: 'https://kelime-defteri.example.workers.dev', publicKey: vapidPub, privateKey: vapidPriv });

// --- headers
assert.equal(payload.method, 'post');
assert.equal(payload.headers['content-encoding'], 'aes128gcm');
assert.equal(payload.headers.ttl, '21600');
const auth = payload.headers.authorization;
assert.match(auth, /^vapid t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+, k=[A-Za-z0-9_-]+$/);
const [, jwt, k] = auth.match(/^vapid t=([^,]+), k=(.+)$/);
assert.equal(k, vapidPub, 'k must be the base64url VAPID public key');

// --- verify the JWT with the public key (ES256, raw r||s signature)
const [h, p, sig] = jwt.split('.');
const header = JSON.parse(Buffer.from(h, 'base64url'));
const claims = JSON.parse(Buffer.from(p, 'base64url'));
assert.deepEqual(header, { typ: 'JWT', alg: 'ES256' });
assert.equal(claims.aud, 'https://web.push.apple.com');
assert.equal(claims.sub, 'https://kelime-defteri.example.workers.dev');
assert.ok(claims.exp - Math.floor(Date.now() / 1000) <= 12 * 3600 && claims.exp > Date.now() / 1000);
const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vk.publicKey, fromB64u(sig), new TextEncoder().encode(`${h}.${p}`));
assert.equal(ok, true, 'JWT signature must verify with the VAPID public key');

// --- decrypt the body as the push service → browser would (RFC 8291 §3, RFC 8188 §2)
const body = new Uint8Array(payload.body);
const salt = body.slice(0, 16);
const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
const idlen = body[20];
assert.equal(idlen, 65);
const serverPub = body.slice(21, 21 + idlen);
const ciphertext = body.slice(21 + idlen);
assert.equal(rs, 4096);
assert.ok(body.length <= 4096, 'push services must accept 4096 bytes');

const serverKey = await crypto.subtle.importKey('raw', serverPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: serverKey }, ck.privateKey, 256));
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}
const te = new TextEncoder();
const keyInfo = new Uint8Array([...te.encode('WebPush: info\0'), ...clientPub, ...serverPub]);
const ikm = await hkdf(authSecret, shared, keyInfo, 32);
const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
const aes = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM', length: 128 }, false, ['decrypt']);
const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, ciphertext));
// strip padding: last record ends with 0x02 then zeros
let end = padded.length - 1;
while (end >= 0 && padded[end] === 0) end--;
assert.equal(padded[end], 0x02, 'record delimiter');
const plaintext = new TextDecoder().decode(padded.slice(0, end));
assert.deepEqual(JSON.parse(plaintext), message);
console.log('push payload OK: VAPID verified, body decrypts to', plaintext.length, 'bytes of JSON');
