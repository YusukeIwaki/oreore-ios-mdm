import { createPrivateKey, createPublicKey } from "node:crypto";
import forge from "node-forge";

/**
 * Self-signed `CN=oreore-mdm DEP` certificate for `GET /dep/pub_key.pem`,
 * built from the DEP key exactly like the Ruby route.
 */
export function buildDepPublicKeyPem(depKeyPem: string, now: Date = new Date()): string {
  const privateKey = createPrivateKey(depKeyPem);
  const pkcs8Pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const spkiPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  const forgePrivateKey = forge.pki.privateKeyFromPem(pkcs8Pem);
  const forgePublicKey = forge.pki.publicKeyFromPem(spkiPem);

  const cert = forge.pki.createCertificate();
  cert.publicKey = forgePublicKey;
  cert.serialNumber = "00";
  cert.validity.notBefore = now;
  cert.validity.notAfter = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  const attrs = [{ name: "commonName", value: "oreore-mdm DEP" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(forgePrivateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}
