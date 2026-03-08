/**
 * Deploy script — builds the project and uploads it to the eisy device.
 *
 * Usage:
 *   bun run scripts/deploy.ts [--host HOST] [--user USER] [--pass PASS] [--dry-run]
 *
 * The built files are uploaded to /WEB/console/ on the eisy,
 * making the app available at https://{host}:8443/WEB/console/index.htm
 */
import { execSync } from 'child_process';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, posix } from 'path';

// ─── CLI Args ─────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1]!;
  return fallback;
}
const dryRun = args.includes('--dry-run');

const HOST = getArg('host', '192.168.4.123');
const PORT = '8443';
const USER = getArg('user', 'admin');
const PASS = getArg('pass', 'admin');
const BASE_URL = `https://${HOST}:${PORT}`;
const UPLOAD_PATH = '/file/upload/WEB/console';
const DIST_DIR = join(import.meta.dir, '..', 'dist');

// ─── Helpers ──────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`  ${msg}`);
}

function logStep(msg: string): void {
  console.log(`\n▸ ${msg}`);
}

/**
 * Recursively collect all files in a directory.
 * Returns relative paths (posix-style forward slashes).
 */
function collectFiles(dir: string, base: string = dir): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, base));
    } else {
      // Use posix separators for URL paths
      const relPath = relative(base, fullPath).split('\\').join('/');
      files.push(relPath);
    }
  }
  return files;
}

/**
 * Upload a single file to the eisy via POST /file/upload.
 * Returns true on success, false on failure.
 */
async function uploadFile(relPath: string, content: Buffer): Promise<boolean> {
  // The eisy upload endpoint: POST /file/upload/WEB/console/{path}?load=n
  const url = `${BASE_URL}${UPLOAD_PATH}/${relPath}?load=n`;
  const auth = Buffer.from(`${USER}:${PASS}`).toString('base64');

  if (dryRun) {
    log(`[DRY RUN] Would upload: ${relPath} (${content.length} bytes)`);
    return true;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/octet-stream',
      },
      body: content,
      // Bun: skip TLS verification for self-signed eisy certificate
      // @ts-expect-error Bun-specific fetch option for self-signed certs
      tls: { rejectUnauthorized: false },
    });

    if (response.ok) {
      log(`  ✓ ${relPath} (${(content.length / 1024).toFixed(1)} KB)`);
      return true;
    } else {
      log(`  ✗ ${relPath} — HTTP ${response.status} ${response.statusText}`);
      return false;
    }
  } catch (err) {
    log(`  ✗ ${relPath} — ${err instanceof Error ? err.message : 'Unknown error'}`);
    return false;
  }
}

// ─── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     eisy Console — Deploy to Device      ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Deploy path: /WEB/console/`);
  if (dryRun) console.log('  Mode: DRY RUN (no files will be uploaded)');

  // Step 1: Build
  logStep('Building production bundle...');
  try {
    execSync('bun run build', {
      cwd: join(import.meta.dir, '..'),
      stdio: 'inherit',
    });
  } catch {
    console.error('\n✗ Build failed. Fix errors and try again.');
    process.exit(1);
  }

  // Step 2: Collect files
  logStep('Collecting build output...');
  let files: string[];
  try {
    files = collectFiles(DIST_DIR);
  } catch {
    console.error(`\n✗ dist/ directory not found at ${DIST_DIR}`);
    console.error('  Run "bun run build" first.');
    process.exit(1);
  }
  log(`Found ${files.length} files to upload`);

  // Step 3: Upload
  logStep(`Uploading to ${BASE_URL}/WEB/console/...`);
  let uploaded = 0;
  let failed = 0;
  let totalBytes = 0;

  for (const relPath of files) {
    const fullPath = join(DIST_DIR, ...relPath.split('/'));
    const content = readFileSync(fullPath);
    totalBytes += content.length;
    const ok = await uploadFile(relPath, content);
    if (ok) uploaded++;
    else failed++;
  }

  // Step 4: Summary
  logStep('Deploy complete!');
  console.log(`  Files uploaded: ${uploaded}/${files.length}`);
  if (failed > 0) console.log(`  Failed: ${failed}`);
  console.log(`  Total size: ${(totalBytes / 1024).toFixed(1)} KB`);
  console.log(`\n  ➜ Open: ${BASE_URL}/WEB/console/index.htm`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Deploy failed:', err);
  process.exit(1);
});
