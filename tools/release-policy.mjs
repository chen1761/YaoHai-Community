import { normalize } from 'node:path';

export const SCAN_EXEMPTIONS = new Set(['tests/repository-policy.js', 'tests/secrets.test.js', 'tests/isolation.test.js', 'tests/release-policy.test.js', 'tools/release-policy.mjs']);
export const RELEASE_FILES = ['package.json', 'server', 'public', '.env.example', 'start-community.ps1', '启动曜海社区版.bat', 'README.md', 'SECURITY.md', 'BRANDING.md', 'NOTICE.md', 'LICENSE', 'docs', 'tools', '.github'];
const forbiddenPath = /(^|\/)(?:\.env(?:\.[^/]+)?|(?:[^/]+\.(?:db|sqlite|sqlite3|db3|wal|shm))|(?:db|data|upload|uploads|service|service-tools|license|generator)(?:\/|$)|(?:license|generator)(?:\.[^/]+)?$)/i;
export function normalizeTrackedPath(file) { return normalize(file).replaceAll('\\', '/'); }
export function isForbiddenTrackedPath(file) { const normalized = normalizeTrackedPath(file); return !new Set(['.env.example', 'LICENSE', 'data/.gitkeep']).has(normalized) && forbiddenPath.test(normalized); }
export function isBinary(buffer) { return buffer.includes(0); }
export function scanText(text, file) {
  if (SCAN_EXEMPTIONS.has(normalizeTrackedPath(file))) return [];
  const patterns = [
    ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/], // policy-rule
    ['provider credential', /\b(?:sk-[A-Za-z0-9_-]{20,}|rk-(?:live|prod)-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{20,})\b/],
    ['hardcoded authorization', /authorization\s*[:=]\s*['"](?:bearer|basic)\s+[^'"\s]+/i], ['master password setting', /APP_MASTER_PASSWORD/], ['license signing setting', /LICENSE_SIGNING_SECRET/], ['administration route', /\/api\/admin(?:\/|\b)/], ['license generation route', /\/api\/license\/code\/generate/], ['payment route', /\/api\/payments(?:\/|\b)/], ['license generator implementation', /(?:function|class)\s+(?:generateLicense|createLicenseCode|signLicense|LicenseGenerator)\b/], // policy-rule
  ];
  return text.split(/\r?\n/).flatMap((line, index) => patterns.filter(([, pattern]) => pattern.test(line)).map(([label]) => ({ file, line: index + 1, label })));
}
