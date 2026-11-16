// Makes a VAPID key pair for due-date reminders and prints it, for you to put where the server reads it:
// `.dev.vars` for the local server, and `npx wrangler secret put` for production. Run it yourself:
//
//   node scripts/vapid-keys.mjs
//
// It writes nothing. The private key is a secret: keep it out of the repository and out of chats. Making a new pair
// later means every browser has to turn reminders on again.

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const point = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

console.log(`VAPID_PUBLIC_KEY=${b64url(point)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
