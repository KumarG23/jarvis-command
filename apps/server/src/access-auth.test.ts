import { generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import { AccessAuthorizationError, createAccessVerifier } from './access-auth';

const issuer = 'https://team.cloudflareaccess.com';
const audience = 'a'.repeat(64);
const allowedEmail = 'operator@example.com';
let privateKey: CryptoKey;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
});

async function makeToken(overrides: {
  audience?: string;
  email?: string;
  issuer?: string;
} = {}): Promise<string> {
  return new SignJWT({ email: overrides.email ?? allowedEmail })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(overrides.issuer ?? issuer)
    .setAudience(overrides.audience ?? audience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

describe('Cloudflare Access verification', () => {
  it('accepts a correctly signed token for the exact approved identity', async () => {
    const verify = createAccessVerifier({
      teamDomain: 'team.cloudflareaccess.com',
      audience,
      allowedEmail,
      key: publicKey,
    });

    await expect(verify(await makeToken())).resolves.toEqual({
      email: allowedEmail,
      provider: 'cloudflare-access',
    });
  });

  it('rejects another valid Cloudflare identity', async () => {
    const verify = createAccessVerifier({
      teamDomain: 'team.cloudflareaccess.com',
      audience,
      allowedEmail,
      key: publicKey,
    });

    await expect(verify(await makeToken({ email: 'intruder@example.com' }))).rejects.toBeInstanceOf(
      AccessAuthorizationError,
    );
  });

  it('rejects a token issued for another Access application', async () => {
    const verify = createAccessVerifier({
      teamDomain: 'team.cloudflareaccess.com',
      audience,
      allowedEmail,
      key: publicKey,
    });

    await expect(verify(await makeToken({ audience: 'b'.repeat(64) }))).rejects.toBeInstanceOf(
      AccessAuthorizationError,
    );
  });

  it('returns one generic error for missing or malformed assertions', async () => {
    const verify = createAccessVerifier({
      teamDomain: 'team.cloudflareaccess.com',
      audience,
      allowedEmail,
      key: publicKey,
    });

    await expect(verify(undefined)).rejects.toThrow('Access authorization failed');
    await expect(verify('not-a-jwt')).rejects.toThrow('Access authorization failed');
  });
});
