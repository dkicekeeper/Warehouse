import { createPrivateKey, sign } from 'node:crypto';

const b64url = (v: Buffer | string) => Buffer.from(v).toString('base64url');

/**
 * A private key as people paste it into a settings field: a PEM, a PEM whose line breaks became
 * `\n` or vanished, the bare base64 body, or the whole PEM base64-encoded. Back to a PEM.
 */
export function pemKey(raw: string): string {
  let text = raw.trim().replace(/\\n/g, '\n');
  if (!text.includes('BEGIN')) {
    const decoded = Buffer.from(text, 'base64').toString('utf8');
    if (decoded.includes('BEGIN')) text = decoded;
  }
  const m = text.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
  const label = m?.[1] ?? 'PRIVATE KEY';
  const body = (m ? m[2]! : text).replace(/\s/g, '');
  const lines = body.match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

/** A JWT signed with ES256 (P-256): what App Store Connect and Apple Ads take as credentials. */
export function es256Jwt(header: Record<string, unknown>, claims: Record<string, unknown>, key: string): string {
  const head = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  // JWT wants the signature as r‖s; Node gives DER unless asked.
  const signature = sign('sha256', Buffer.from(head), { key: createPrivateKey(pemKey(key)), dsaEncoding: 'ieee-p1363' });
  return `${head}.${b64url(signature)}`;
}

/** An error from a source that says what failed and never what the source answered. */
export class SourceError extends Error {
  constructor(
    readonly status: number,
    what: string,
  ) {
    super(`${what}: HTTP ${status}`);
  }
}
