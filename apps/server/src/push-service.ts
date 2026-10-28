import { createECDH } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import webpush from 'web-push';
import type { PushCapability, PushSubscription } from '@jarvis-command/contracts';
import type { NotificationStore } from './notification-store';

export type PushConfig = Readonly<{ capability: PushCapability; vapid?: { subject: string; publicKey: string; privateKey: string } }>;
export function pushConfig(environment: NodeJS.ProcessEnv): PushConfig {
  if (environment.WEB_PUSH_MODE !== 'enabled') return { capability: { state: 'unavailable', reason: 'disabled' } };
  try {
    const publicKey = environment.WEB_PUSH_VAPID_PUBLIC_KEY ?? '';
    const privateKey = environment.WEB_PUSH_VAPID_PRIVATE_KEY ?? '';
    const subject = environment.WEB_PUSH_VAPID_SUBJECT ?? '';
    if (!/^B[A-Za-z0-9_-]{86}$/.test(publicKey) || !/^[A-Za-z0-9_-]{43}$/.test(privateKey)
      || !/^mailto:[A-Za-z0-9._+-]{1,80}@[A-Za-z0-9.-]{1,100}$/.test(subject)) throw new Error();
    const key = createECDH('prime256v1');
    key.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    if (key.getPublicKey().toString('base64url') !== publicKey) throw new Error();
    return { capability: { state: 'available', publicKey }, vapid: { subject, publicKey, privateKey } };
  } catch { return { capability: { state: 'unavailable', reason: 'configuration' } }; }
}

// Exact HTTPS origins, restricted provider paths and token alphabet. No credentials/query/fragment,
// alternate ports, encoded path separators, suffix matches or caller-selected hostnames.
export function supportedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash || url.href !== endpoint) return false;
    return (url.hostname === 'fcm.googleapis.com' && /^\/fcm\/send\/[A-Za-z0-9_:.-]{1,1800}$/.test(url.pathname))
      || (url.hostname === 'updates.push.services.mozilla.com' && /^\/wpush\/v2\/[A-Za-z0-9_-]{1,1800}$/.test(url.pathname))
      || (url.hostname === 'web.push.apple.com' && /^\/[A-Za-z0-9_/-]{1,1800}$/.test(url.pathname) && !url.pathname.includes('//'));
  } catch { return false; }
}

// Transport deliberately uses only public IPv4. IPv6-only destinations are unavailable rather
// than falling back to an unvalidated address. Broad reserved ranges are denied conservatively.
export function publicPushAddress(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number) as [number, number, number, number];
  return a > 0 && a < 224 && ![10, 127, 169, 192, 198, 203].includes(a)
    && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 100 && b >= 64 && b <= 127);
}
export type PushRequest = Readonly<{ endpoint: string; headers: Record<string, string | number>; body: Buffer }>;
export type PushTransport = (details: PushRequest) => Promise<number>;
const TIMEOUT_MS = 5000;

/** No automatic redirect/retry/proxy. One absolute timeout includes DNS, connect, TLS and headers. */
export const restrictedPushTransport: PushTransport = async details => {
  if (!supportedPushEndpoint(details.endpoint) || details.body.length > 4096) throw new Error('Push unavailable');
  return new Promise<number>((resolve, reject) => {
    let req: ReturnType<typeof request> | undefined;
    let settled = false;
    const finish = (status?: number) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      req?.destroy();
      if (status === undefined) reject(new Error('Push outcome unknown')); else resolve(status);
    };
    const timer = setTimeout(() => finish(), TIMEOUT_MS);
    void lookup(new URL(details.endpoint).hostname, { family: 4, all: true }).then(addresses => {
      if (settled) return;
      if (!addresses.length || addresses.some(value => !publicPushAddress(value.address))) { finish(); return; }
      const address = addresses[0]!.address;
      req = request(details.endpoint, {
        method: 'POST', headers: details.headers, agent: false, family: 4,
        lookup: (_host, _options, callback) => callback(null, address, 4),
      }, response => { response.destroy(); finish(response.statusCode); });
      req.on('error', () => finish());
      req.end(details.body);
    }).catch(() => finish());
  });
};

export const privatePushPayload = (id: string) => JSON.stringify({ version: 1, id });
export function createPushService(config: PushConfig, store: NotificationStore, transport: PushTransport = restrictedPushTransport) {
  return {
    config,
    async deliver(actor: string, id: string) {
      if (config.capability.state !== 'available' || !config.vapid) return;
      try {
        const devices = await store.claimPush(actor, id);
        await Promise.all(devices.map(async device => {
          let outcome: 'sent' | 'failed' | 'expired' | 'unknown' = 'unknown';
          try {
            if (!supportedPushEndpoint(device.subscription.endpoint)) throw new Error('Unsupported destination');
            const details = webpush.generateRequestDetails(device.subscription as PushSubscription, privatePushPayload(id), {
              vapidDetails: config.vapid, TTL: 300, urgency: 'normal', contentEncoding: 'aes128gcm',
            });
            if (!Buffer.isBuffer(details.body) || details.body.length > 4096) throw new Error('Push too large');
            const status = await transport({ endpoint: device.subscription.endpoint, headers: details.headers, body: details.body });
            outcome = status >= 200 && status < 300 ? 'sent' : status === 404 || status === 410 ? 'expired' : 'failed';
          } catch { /* ambiguous send stays unknown; never retry */ }
          await store.finishPush(actor, id, device.id, outcome).catch(() => undefined);
        }));
      } catch { /* notification health cannot block audit/status/admission */ }
    },
  };
}
export type PushService = ReturnType<typeof createPushService>;
