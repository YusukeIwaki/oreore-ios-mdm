import { createPrivateKey, createPublicKey } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

/**
 * GetToken RS256 JWTs (crypto part of `GetTokenGenerator`).
 * `DEP_KEY_BASE64` decodes to a PEM RSA private key (PKCS#1 or PKCS#8).
 */

export interface GetTokenClaims {
  service_type: string;
  iss: string;
  iat: number;
  jti: string;
}

export async function mintGetToken(
  privateKeyPem: string,
  claims: GetTokenClaims,
): Promise<string> {
  // Claim insertion order (service_type, iss, iat, jti) matches the Ruby hash.
  return await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "RS256" })
    .sign(createPrivateKey(privateKeyPem));
}

export async function verifyGetToken(
  publicKeyPem: string,
  token: string,
): Promise<GetTokenClaims> {
  const { payload } = await jwtVerify(token, createPublicKey(publicKeyPem));
  return payload as unknown as GetTokenClaims;
}
