export const APP_VERSION = '3.3.0';
export const APP_VERSION_CODE = 7;
export const GITHUB_REPO = 'cengiz718/EYMEN-TV-RADYO';

export function compareSemver(a: string, b: string): number {
  const cleanA = a.replace(/^v/i, '').split('-')[0].split('.').map(Number);
  const cleanB = b.replace(/^v/i, '').split('-')[0].split('.').map(Number);
  const len = Math.max(cleanA.length, cleanB.length);
  for (let i = 0; i < len; i++) {
    const va = Number.isFinite(cleanA[i]) ? cleanA[i] : 0;
    const vb = Number.isFinite(cleanB[i]) ? cleanB[i] : 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}
