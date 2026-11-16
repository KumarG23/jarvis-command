// Keep the most specific safe reason when a storage wrapper rethrows. Only fixed,
// code-defined values pass: an inner store reason or a Node fs error code. Never a
// message, path, identity or input.
export function storageReason(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const reason = 'reason' in error ? error.reason : undefined;
    if (typeof reason === 'string' && reason !== 'unspecified' && /^[a-z_]{1,64}$/.test(reason)) return reason;
    const code = 'code' in error ? error.code : undefined;
    if (typeof code === 'string' && /^E[A-Z]{1,30}$/.test(code)) return `fs_${code.toLowerCase()}`;
  }
  return 'unspecified';
}
