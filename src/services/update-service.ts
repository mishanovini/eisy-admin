/**
 * Update service — checks GitHub Releases for new versions and self-updates
 * by downloading the release asset and uploading files to the eisy device.
 *
 * Architecture:
 *   1. On startup, fetch latest release from GitHub Releases API
 *   2. Compare semver with __APP_VERSION__ (injected at build time)
 *   3. If newer, show UpdateBanner with release notes
 *   4. "Update Now" downloads the .zip asset, extracts via JSZip,
 *      and uploads each file to the eisy via POST /file/upload/WEB/console/{path}
 *   5. After upload completes, reload the page to run the new version
 */
import { create } from 'zustand';
import { getConnectionConfig } from '@/api/client.ts';
import { APP_VERSION } from '@/utils/version.ts';

// ─── Constants ────────────────────────────────────────────────

const GITHUB_OWNER = 'MishaPT';
const GITHUB_REPO = 'eisy-admin';
const STORAGE_KEY = 'eisy-update';

// ─── Types ────────────────────────────────────────────────────

interface UpdateState {
  /** Latest available version from GitHub (e.g., "0.2.0") */
  latestVersion: string | null;
  /** Release notes markdown */
  releaseNotes: string | null;
  /** URL to the GitHub release page */
  releaseUrl: string | null;
  /** URL to download the .zip release asset */
  assetUrl: string | null;
  /** User dismissed this version's update banner */
  dismissedVersion: string | null;
  /** Timestamp of last check */
  lastChecked: number;
  /** Whether an update is in progress */
  updating: boolean;
  /** Upload progress during self-update */
  updateProgress: { current: number; total: number } | null;
  /** Error message if update check or apply fails */
  error: string | null;

  /** Check GitHub for a newer version */
  checkForUpdate: () => Promise<void>;
  /** Download and apply the update to the eisy */
  applyUpdate: () => Promise<void>;
  /** Dismiss the update banner for the current version */
  dismissUpdate: () => void;
  /** Whether an update is available and not dismissed */
  isUpdateAvailable: () => boolean;
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Compare two semver strings. Returns:
 *  - positive if a > b (a is newer)
 *  - negative if a < b
 *  - 0 if equal
 */
function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * Upload a single file to the eisy device.
 * Mirrors the pattern from scripts/deploy.ts but runs in the browser.
 */
async function uploadFileToEisy(
  relPath: string,
  content: ArrayBuffer,
): Promise<boolean> {
  const config = getConnectionConfig();

  // Build upload URL — in production (no explicit host), use same-origin
  let baseUrl: string;
  if (config.host) {
    baseUrl = `${config.protocol}://${config.host}:${config.port}`;
  } else {
    baseUrl = '';
  }

  const url = `${baseUrl}/file/upload/WEB/console/${relPath}?load=n`;
  const auth = btoa(`${config.username}:${config.password}`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/octet-stream',
      },
      body: content,
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ─── Persisted State ──────────────────────────────────────────

function loadPersistedState(): Partial<UpdateState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return {
      dismissedVersion: data.dismissedVersion ?? null,
      lastChecked: data.lastChecked ?? 0,
    };
  } catch {
    return {};
  }
}

function persistState(state: UpdateState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      dismissedVersion: state.dismissedVersion,
      lastChecked: state.lastChecked,
    }));
  } catch {
    // localStorage unavailable
  }
}

// ─── Store ────────────────────────────────────────────────────

const persisted = loadPersistedState();

export const useUpdateStore = create<UpdateState>((set, get) => ({
  latestVersion: null,
  releaseNotes: null,
  releaseUrl: null,
  assetUrl: null,
  dismissedVersion: persisted.dismissedVersion ?? null,
  lastChecked: persisted.lastChecked ?? 0,
  updating: false,
  updateProgress: null,
  error: null,

  checkForUpdate: async () => {
    try {
      // Fetch latest release from GitHub API (unauthenticated for public repos)
      const response = await fetch(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
        { headers: { Accept: 'application/vnd.github.v3+json' } },
      );

      if (!response.ok) {
        // 404 = no releases yet, not an error
        if (response.status === 404) {
          set({ lastChecked: Date.now(), error: null });
          persistState(get());
          return;
        }
        throw new Error(`GitHub API returned ${response.status}`);
      }

      const release = await response.json();
      const tagName = String(release.tag_name ?? '');
      const version = tagName.replace(/^v/, '');
      const currentVersion = APP_VERSION;

      if (compareSemver(version, currentVersion) > 0) {
        // Find the .zip asset (dist.zip or similar)
        const assets = release.assets as { name: string; browser_download_url: string }[];
        const zipAsset = assets.find((a) => a.name.endsWith('.zip'));

        set({
          latestVersion: version,
          releaseNotes: release.body ?? null,
          releaseUrl: release.html_url ?? null,
          assetUrl: zipAsset?.browser_download_url ?? null,
          lastChecked: Date.now(),
          error: null,
        });
      } else {
        set({
          latestVersion: null,
          releaseNotes: null,
          releaseUrl: null,
          assetUrl: null,
          lastChecked: Date.now(),
          error: null,
        });
      }

      persistState(get());
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Update check failed' });
    }
  },

  applyUpdate: async () => {
    const { assetUrl, latestVersion } = get();
    if (!assetUrl || !latestVersion) return;

    set({ updating: true, updateProgress: null, error: null });

    try {
      // Step 1: Download the .zip asset
      const response = await fetch(assetUrl);
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      const zipData = await response.arrayBuffer();

      // Step 2: Extract with JSZip (dynamically imported to keep initial bundle small)
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(zipData);

      // Collect all files from the zip
      const files: { path: string; data: ArrayBuffer }[] = [];
      const entries = Object.entries(zip.files);

      for (const [name, file] of entries) {
        if (file.dir) continue;
        // Strip leading "dist/" prefix if present (release may package as dist/...)
        const cleanPath = name.replace(/^dist\//, '');
        if (!cleanPath) continue;
        const data = await file.async('arraybuffer');
        files.push({ path: cleanPath, data });
      }

      if (files.length === 0) throw new Error('No files found in release asset');

      // Step 3: Upload each file to the eisy
      set({ updateProgress: { current: 0, total: files.length } });

      let uploadedCount = 0;
      let failedCount = 0;

      for (const { path, data } of files) {
        const ok = await uploadFileToEisy(path, data);
        if (ok) {
          uploadedCount++;
        } else {
          failedCount++;
          console.error(`[Update] Failed to upload: ${path}`);
        }
        set({ updateProgress: { current: uploadedCount + failedCount, total: files.length } });
      }

      if (failedCount > 0) {
        throw new Error(`Failed to upload ${failedCount}/${files.length} files`);
      }

      // Step 4: Success — reload the page to run the new version
      set({ updating: false, updateProgress: null });
      console.log(`[Update] Successfully updated to v${latestVersion}. Reloading...`);

      // Short delay so the user sees "complete" before reload
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      set({
        updating: false,
        updateProgress: null,
        error: err instanceof Error ? err.message : 'Update failed',
      });
    }
  },

  dismissUpdate: () => {
    const { latestVersion } = get();
    set({ dismissedVersion: latestVersion });
    persistState(get());
  },

  isUpdateAvailable: () => {
    const { latestVersion, dismissedVersion } = get();
    if (!latestVersion) return false;
    if (dismissedVersion === latestVersion) return false;
    return true;
  },
}));

/** Export constants for use by other modules (e.g., GitHub API client) */
export { GITHUB_OWNER, GITHUB_REPO };
