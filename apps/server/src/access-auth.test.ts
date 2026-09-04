import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import { AccessAuthorizationError, createAccessVerifier } from './access-auth';

const issuer = 'https://team.cloudflareaccess.com';
const audience = 'a'.repeat(64);
const allowedEmail = 'operator@example.com';
const allowedEmailHash = createHash('sha256').update(allowedEmail).digest('hex');
const refreshJwksScript = fileURLToPath(
  new URL('../../../deploy/refresh-cloudflare-jwks.sh', import.meta.url),
);
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
  expiration?: string | null;
  issuer?: string;
  subject?: string | null;
  type?: string;
} = {}): Promise<string> {
  const token = new SignJWT({
    email: overrides.email ?? allowedEmail,
    type: overrides.type ?? 'app',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(overrides.issuer ?? issuer)
    .setAudience(overrides.audience ?? audience)
    .setIssuedAt();

  if (overrides.expiration !== null) {
    token.setExpirationTime(overrides.expiration ?? '5m');
  }

  if (overrides.subject !== null) {
    token.setSubject(overrides.subject ?? 'human-subject-123');
  }

  return token.sign(privateKey);
}

describe('Cloudflare Access verification', () => {
  it('preserves a cryptographically usable cache when refresh input only mimics JWKS shape', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-command-jwks-boundary-'));
    const source = join(directory, 'source.json');
    const curl = join(directory, 'curl');
    const outputDirectory = join(directory, 'output');
    const jwksFile = join(outputDirectory, 'certs.json');

    try {
      await writeFile(curl, `#!/usr/bin/env bash
set -euo pipefail
output=''
while (($#)); do
  case "$1" in
    --output) output=$2; shift 2 ;;
    *) shift ;;
  esac
done
cp ${JSON.stringify(source)} "$output"
`);
      await chmod(curl, 0o755);

      const pair = await generateKeyPair('RS256');
      const publicJwk = await exportJWK(pair.publicKey);
      const good = JSON.stringify({
        keys: [{ ...publicJwk, alg: 'RS256', kid: 'boundary-key', use: 'sig' }],
      });
      const environment = { ...process.env, CURL_BIN: curl };
      await writeFile(source, good);

      const first = spawnSync(refreshJwksScript, [
        'team.cloudflareaccess.com', outputDirectory,
      ], { encoding: 'utf8', env: environment });
      expect(first.status, first.stderr).toBe(0);

      const verifier = createAccessVerifier({
        teamDomain: 'team.cloudflareaccess.com',
        audience,
        allowedEmailHash,
        jwksFile,
      });
      const token = await new SignJWT({ email: allowedEmail, type: 'app' })
        .setProtectedHeader({ alg: 'RS256', kid: 'boundary-key' })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject('human-subject-123')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(pair.privateKey);
      await expect(verifier(token)).resolves.toEqual({
        subject: 'human-subject-123',
        provider: 'cloudflare-access',
      });

      const poisonedInputs = [
        JSON.stringify({
          keys: [{ alg: 'RS256', kid: 'boundary-key', kty: 'RSA', use: 'sig' }],
        }),
        JSON.stringify({
          keys: [{ ...publicJwk, alg: 'RS256', kid: 'boundary-key', key_ops: ['verify', 'verify'], use: 'sig' }],
        }),
        JSON.stringify({
          keys: [{ ...publicJwk, alg: 'RS256', kid: 'boundary-key', key_ops: ['verify', 'encrypt'], use: 'sig' }],
        }),
        JSON.stringify({
          keys: [{ ...publicJwk, alg: 'RS256', ext: false, kid: 'boundary-key', use: 'sig' }],
        }),
        JSON.stringify({
          keys: [{ ...publicJwk, alg: 'RS256', e: 'Ax', kid: 'boundary-key', use: 'sig' }],
        }),
        `{"keys":[{"kty":"RSA","alg":"RS256","kid":"boundary-key","use":"sig","n":"${publicJwk.n}","e":"${publicJwk.e}","unexpected":NaN}]}`,
      ];

      for (const poisonedInput of poisonedInputs) {
        await writeFile(source, poisonedInput);
        const rejected = spawnSync(refreshJwksScript, [
          'team.cloudflareaccess.com', outputDirectory,
        ], { encoding: 'utf8', env: environment });

        expect(rejected.status).not.toBe(0);
        expect(await readFile(jwksFile, 'utf8')).toBe(`${good}\n`);
        await expect(verifier(token)).resolves.toEqual({
          subject: 'human-subject-123',
          provider: 'cloudflare-access',
        });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('reloads a local JWKS file so key rotation needs no app egress or restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-command-jwks-'));
    const jwksFile = join(directory, 'certs.json');
    const fileTeamDomain = '127.0.0.1:9';
    const fileIssuer = `https://${fileTeamDomain}`;

    const signFor = async (pair: Awaited<ReturnType<typeof generateKeyPair>>, kid: string) => {
      const token = new SignJWT({ email: allowedEmail, type: 'app' })
        .setProtectedHeader({ alg: 'RS256', kid })
        .setIssuer(fileIssuer)
        .setAudience(audience)
        .setSubject('human-subject-123')
        .setIssuedAt()
        .setExpirationTime('5m');
      return token.sign(pair.privateKey);
    };
    const writeKey = async (pair: Awaited<ReturnType<typeof generateKeyPair>>, kid: string) => {
      const key = await exportJWK(pair.publicKey);
      await writeFile(jwksFile, JSON.stringify({
        keys: [{ ...key, alg: 'RS256', kid, use: 'sig' }],
      }));
    };

    try {
      const firstPair = await generateKeyPair('RS256');
      const secondPair = await generateKeyPair('RS256');
      await writeKey(firstPair, 'first-key');
      const verify = createAccessVerifier({
        teamDomain: fileTeamDomain,
        audience,
        allowedEmailHash,
        jwksFile,
      });

      await expect(verify(await signFor(firstPair, 'first-key'))).resolves.toEqual({
        subject: 'human-subject-123',
        provider: 'cloudflare-access',
      });

      await writeKey(secondPair, 'second-key');
      await expect(verify(await signFor(secondPair, 'second-key'))).resolves.toEqual({
        subject: 'human-subject-123',
        provider: 'cloudflare-access',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('accepts a correctly signed token for the exact approved identity', async () => {
    const verify = createAccessVerifier({
      teamDomain: 'team.cloudflareaccess.com',
      audience,
      allowedEmailHash,
      key: publicKey,
    });

    await expect(verify(await makeToken())).resolves.toEqual({
      subject: 'human-subject-123',
      provider: 'cloudflare-access',
    });
  });

  it('rejects another valid Cloudflare identity', async () => {
    const verify = createAccessVerifier({
      teamDomain: 'team.cloudflareaccess.com',
      audience,
      allowedEmailHash,
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
      allowedEmailHash,
      key: publicKey,
    });

    await expect(verify(await makeToken({ audience: 'b'.repeat(64) }))).rejects.toBeInstanceOf(
      AccessAuthorizationError,
    );
  });

  it('rejects a signed assertion without an expiration claim', async () => {
    const verify = createAccessVerifier({
      teamDomain: 'team.cloudflareaccess.com',
      audience,
      allowedEmailHash,
      key: publicKey,
    });

    await expect(verify(await makeToken({ expiration: null }))).rejects.toBeInstanceOf(
      AccessAuthorizationError,
    );
  });

  it('rejects an expired signed assertion', async () => {
    const verify = createAccessVerifier({
      teamDomain: 'team.cloudflareaccess.com',
      audience,
      allowedEmailHash,
      key: publicKey,
    });

    await expect(verify(await makeToken({ expiration: '0s' }))).rejects.toBeInstanceOf(
      AccessAuthorizationError,
    );
  });

  it.each([
    ['a service token', { type: 'service-token' }],
    ['a token without a human subject', { subject: null }],
    ['a token with an empty subject', { subject: '' }],
  ])('rejects %s', async (_label, overrides) => {
    const verify = createAccessVerifier({
      teamDomain: 'team.cloudflareaccess.com',
      audience,
      allowedEmailHash,
      key: publicKey,
    });

    await expect(verify(await makeToken(overrides))).rejects.toBeInstanceOf(
      AccessAuthorizationError,
    );
  });

  it('returns one generic error for missing or malformed assertions', async () => {
    const verify = createAccessVerifier({
      teamDomain: 'team.cloudflareaccess.com',
      audience,
      allowedEmailHash,
      key: publicKey,
    });

    await expect(verify(undefined)).rejects.toThrow('Access authorization failed');
    await expect(verify('not-a-jwt')).rejects.toThrow('Access authorization failed');
  });
});
