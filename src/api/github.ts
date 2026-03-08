/**
 * GitHub API client — creates issues and syncs status from GitHub.
 *
 * Uses a fine-grained Personal Access Token (PAT) with `issues: write` scope.
 * The PAT can be:
 *   1. Embedded via VITE_GITHUB_PAT env variable (build-time)
 *   2. Overridden by user in Settings (stored in localStorage)
 *
 * Issue status is communicated via HTML comments in GitHub issue comments:
 *   <!-- STATUS: acknowledged -->
 *   <!-- STATUS: in-progress -->
 *   <!-- STATUS: resolved:0.2.0 -->
 */
import { GITHUB_OWNER, GITHUB_REPO } from '@/services/update-service.ts';
import type { IssueReport, IssueStatus } from '@/stores/issue-store.ts';

// ─── Configuration ────────────────────────────────────────────

const STORAGE_KEY = 'eisy-github-pat';
const API_BASE = 'https://api.github.com';

/** Get the GitHub PAT — user override > env variable > empty */
function getToken(): string {
  try {
    const override = localStorage.getItem(STORAGE_KEY);
    if (override) return override;
  } catch {
    // localStorage unavailable
  }
  // Build-time PAT from env variable
  return import.meta.env.VITE_GITHUB_PAT ?? '';
}

/** Set a user-provided PAT override */
export function setGitHubToken(token: string): void {
  try {
    if (token) {
      localStorage.setItem(STORAGE_KEY, token);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage unavailable
  }
}

/** Get the current PAT (for display in settings, masked) */
export function getGitHubTokenMasked(): string {
  const token = getToken();
  if (!token) return '';
  if (token.length <= 8) return '****';
  return token.slice(0, 4) + '****' + token.slice(-4);
}

/** Check if a GitHub token is configured */
export function hasGitHubToken(): boolean {
  return getToken().length > 0;
}

// ─── API Helpers ──────────────────────────────────────────────

async function githubFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (options.method === 'POST' || options.method === 'PATCH') {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
}

// ─── Issue Creation ───────────────────────────────────────────

/**
 * Format an IssueReport into a GitHub issue body (Markdown).
 */
function formatIssueBody(report: IssueReport): string {
  const sections: string[] = [];

  // Description
  sections.push(`## Description\n\n${report.description}`);

  // AI Diagnosis
  if (report.aiDiagnosis) {
    sections.push(`## AI Diagnosis\n\n${report.aiDiagnosis}`);
  }

  // Proposed Fix
  if (report.proposedFix) {
    sections.push(`## Proposed Fix\n\n${report.proposedFix}`);
  }

  // Affected Devices
  if (report.deviceNames?.length) {
    const deviceList = report.deviceNames.map((name, i) => {
      const addr = report.devices?.[i];
      return addr ? `- ${name} (\`${addr}\`)` : `- ${name}`;
    }).join('\n');
    sections.push(`## Affected Devices\n\n${deviceList}`);
  }

  // System Info
  if (report.systemInfo) {
    const si = report.systemInfo;
    sections.push(`## System Info\n
| Property | Value |
|----------|-------|
| App Version | v${si.appVersion} |
| Devices | ${si.deviceCount} |
| Scenes | ${si.sceneCount} |
| Programs | ${si.programCount} |
| WebSocket | ${si.wsConnected ? 'Connected' : 'Disconnected'} |
| Timestamp | ${new Date(si.timestamp).toISOString()} |`);
  }

  // Recent Logs (last 10)
  if (report.logs?.length) {
    const logLines = report.logs.slice(0, 10).map((log) => {
      const time = new Date(log.timestamp).toLocaleTimeString();
      return `| ${time} | ${log.category} | ${log.deviceName ?? log.device ?? '—'} | ${log.action} | ${log.result} |`;
    }).join('\n');

    sections.push(`## Recent Logs\n
| Time | Category | Device | Action | Result |
|------|----------|--------|--------|--------|
${logLines}`);
  }

  return sections.join('\n\n---\n\n');
}

/**
 * Create a GitHub issue from an IssueReport.
 * Returns the issue number and URL on success.
 */
export async function createGitHubIssue(
  report: IssueReport,
): Promise<{ number: number; url: string }> {
  const title = `[${report.type === 'bug' ? 'Bug' : 'Feature'}] ${report.title}`;
  const body = formatIssueBody(report);
  const labels = [report.type === 'bug' ? 'bug' : 'enhancement', 'user-report'];

  const response = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`,
    {
      method: 'POST',
      body: JSON.stringify({ title, body, labels }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create GitHub issue: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return {
    number: data.number,
    url: data.html_url,
  };
}

// ─── Status Sync ──────────────────────────────────────────────

interface GitHubIssueStatus {
  state: 'open' | 'closed';
  status: IssueStatus;
  resolution?: string;
  resolvedVersion?: string;
}

/**
 * Parse status from a GitHub issue's comments.
 * Developer communicates status via HTML comments:
 *   <!-- STATUS: acknowledged -->
 *   <!-- STATUS: in-progress -->
 *   <!-- STATUS: resolved:0.2.0 -->
 */
function parseStatusFromComment(body: string): { status?: IssueStatus; resolvedVersion?: string } {
  const match = body.match(/<!--\s*STATUS:\s*(\S+)\s*-->/);
  if (!match) return {};

  const rawStatus = match[1]!.toLowerCase();

  if (rawStatus === 'acknowledged') return { status: 'acknowledged' };
  if (rawStatus === 'in-progress') return { status: 'in-progress' };
  if (rawStatus.startsWith('resolved')) {
    const version = rawStatus.split(':')[1];
    return { status: 'resolved', resolvedVersion: version };
  }
  if (rawStatus === 'closed') return { status: 'closed' };

  return {};
}

/**
 * Get the current status of a GitHub issue.
 * Reads issue state + comments for status markers.
 */
export async function getGitHubIssueStatus(
  issueNumber: number,
): Promise<GitHubIssueStatus> {
  // Fetch the issue
  const issueResp = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}`,
  );

  if (!issueResp.ok) {
    throw new Error(`Failed to fetch issue #${issueNumber}: ${issueResp.status}`);
  }

  const issue = await issueResp.json();
  const isClosed = issue.state === 'closed';

  // Fetch comments (latest first via sort)
  const commentsResp = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}/comments?sort=created&direction=desc&per_page=10`,
  );

  let latestStatus: IssueStatus = isClosed ? 'closed' : 'submitted';
  let resolvedVersion: string | undefined;
  let resolution: string | undefined;

  if (commentsResp.ok) {
    const comments = await commentsResp.json() as { body: string }[];

    // Find the latest status marker in comments
    for (const comment of comments) {
      const parsed = parseStatusFromComment(comment.body);
      if (parsed.status) {
        latestStatus = parsed.status;
        resolvedVersion = parsed.resolvedVersion;
        // Use the comment body (minus the STATUS marker) as resolution text
        resolution = comment.body.replace(/<!--\s*STATUS:\s*\S+\s*-->/, '').trim() || undefined;
        break;
      }
    }
  }

  return {
    state: issue.state,
    status: latestStatus,
    resolution,
    resolvedVersion,
  };
}

/**
 * Sync statuses for multiple issues.
 * Returns a map of issue number → status.
 */
export async function syncGitHubIssueStatuses(
  issueNumbers: number[],
): Promise<Map<number, GitHubIssueStatus>> {
  const results = new Map<number, GitHubIssueStatus>();

  // Fetch in series to avoid rate limiting (max ~10 issues typically)
  for (const num of issueNumbers) {
    try {
      const status = await getGitHubIssueStatus(num);
      results.set(num, status);
    } catch (err) {
      console.error(`[GitHub] Failed to sync issue #${num}:`, err);
    }
  }

  return results;
}

/**
 * Test the GitHub token by fetching the repo info.
 */
export async function testGitHubConnection(): Promise<{
  ok: boolean;
  message: string;
}> {
  const token = getToken();
  if (!token) {
    return { ok: false, message: 'No GitHub token configured' };
  }

  try {
    const resp = await githubFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}`);
    if (resp.ok) {
      const data = await resp.json();
      return {
        ok: true,
        message: `Connected to ${data.full_name} (${data.visibility})`,
      };
    }
    return { ok: false, message: `GitHub API returned ${resp.status}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Connection failed' };
  }
}
