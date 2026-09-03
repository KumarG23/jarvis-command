import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';

export type AccessIdentity = Readonly<{
  email: string;
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
  allowedEmail: string;
  key?: VerificationKey;
}>;

export function createAccessVerifier(options: AccessVerifierOptions) {
  const issuer = `https://${options.teamDomain}`;
  const key = options.key ?? createRemoteJWKSet(
    new URL(`${issuer}/cdn-cgi/access/certs`),
  );
  const allowedEmail = options.allowedEmail.toLowerCase();

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
      });
      const email = typeof payload.email === 'string'
        ? payload.email.toLowerCase()
        : null;

      if (email !== allowedEmail) {
        throw new AccessAuthorizationError();
      }

      return Object.freeze({
        email,
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
