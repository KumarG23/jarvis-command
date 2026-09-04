import { createHash, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import {
  createLocalJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from 'jose';

const MAX_JWKS_BYTES = 65_536;

export type AccessIdentity = Readonly<{
  subject: string;
  provider: 'cloudflare-access';
}>;

export class AccessAuthorizationError extends Error {
  public constructor() {
    super('Access authorization failed');
    this.name = 'AccessAuthorizationError';
  }
}

type VerificationKey = CryptoKey | JWTVerifyGetKey;

type AccessVerifierOptions = Readonly<{
  teamDomain: string;
  audience: string;
  allowedEmailHash: string;
  jwksFile?: string;
  key?: VerificationKey;
}>;

export function createAccessVerifier(options: AccessVerifierOptions) {
  const issuer = `https://${options.teamDomain}`;
  const key = options.key ?? (
    options.jwksFile
      ? createFileJWKSet(options.jwksFile)
      : (() => { throw new Error('A local JWKS file is required'); })()
  );
  const allowedEmailHash = Buffer.from(options.allowedEmailHash, 'hex');

  return async function verifyAccessAssertion(
    assertion: string | undefined,
  ): Promise<AccessIdentity> {
    if (!assertion) {
      throw new AccessAuthorizationError();
    }

    try {
      const { payload } = await jwtVerify(assertion, key, {
        algorithms: ['RS256'],
        audience: options.audience,
        issuer,
        requiredClaims: ['exp', 'email', 'sub', 'type'],
      });
      const email = typeof payload.email === 'string'
        ? payload.email.toLowerCase()
        : null;
      const isHumanApplicationToken = payload.type === 'app'
        && typeof payload.sub === 'string'
        && payload.sub.trim().length > 0;

      if (
        email === null
        || !hashMatches(email, allowedEmailHash)
        || !isHumanApplicationToken
      ) {
        throw new AccessAuthorizationError();
      }

      return Object.freeze({
        subject: payload.sub as string,
        provider: 'cloudflare-access' as const,
      });
    } catch (error) {
      if (error instanceof AccessAuthorizationError) {
        throw error;
      }

      throw new AccessAuthorizationError();
    }
  };
}

function createFileJWKSet(path: string): JWTVerifyGetKey {
  return async (protectedHeader, token) => {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_JWKS_BYTES) {
        throw new Error('Invalid local JWKS file');
      }

      const parsed: unknown = JSON.parse(await handle.readFile({ encoding: 'utf8' }));
      if (!isJsonWebKeySet(parsed)) {
        throw new Error('Invalid local JWKS payload');
      }

      return createLocalJWKSet(parsed)(protectedHeader, token);
    } finally {
      await handle.close();
    }
  };
}

function isJsonWebKeySet(value: unknown): value is JSONWebKeySet {
  if (!value || typeof value !== 'object' || !('keys' in value)) return false;
  const { keys } = value as { keys?: unknown };
  return Array.isArray(keys)
    && keys.length > 0
    && keys.length <= 16
    && keys.every((key) => key !== null && typeof key === 'object' && !Array.isArray(key));
}

function hashMatches(email: string, expected: Buffer): boolean {
  const actual = createHash('sha256').update(email).digest();
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
