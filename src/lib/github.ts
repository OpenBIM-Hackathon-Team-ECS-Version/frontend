import type { GitBranch, GitCommit, GitFileEntry, RepoRef } from "../types/git";
import type { GitRepoTreeEntry } from "../types/repo";
import {
  getGitHubBranches,
  getGitHubCommits,
  getGitHubFileBuffer,
  getGitHubFileHistory,
  getGitHubRepoTree,
} from "./api";

export const SAMPLE_REPO_URL =
  "https://github.com/OpenBIM-Hackathon-Team-ECS-Version/File-Storage";
export const SAMPLE_REPO: RepoRef = {
  owner: "OpenBIM-Hackathon-Team-ECS-Version",
  name: "File-Storage",
};

const requestCache = new Map<string, { savedAt: number; value: unknown }>();
const inFlightRequests = new Map<string, Promise<unknown>>();
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;

function getCachedRequest<T>(key: string, maxAgeMs = DEFAULT_CACHE_TTL_MS) {
  const cached = requestCache.get(key);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.savedAt > maxAgeMs) {
    requestCache.delete(key);
    return null;
  }

  return cached.value as T;
}

function setCachedRequest<T>(key: string, value: T) {
  requestCache.set(key, {
    savedAt: Date.now(),
    value,
  });
}

async function getOrCreateRequest<T>(key: string, load: () => Promise<T>) {
  const cached = getCachedRequest<T>(key);
  if (cached !== null) {
    return cached;
  }

  const inFlight = inFlightRequests.get(key);
  if (inFlight) {
    return (await inFlight) as T;
  }

  const promise = load()
    .then((value) => {
      setCachedRequest(key, value);
      return value;
    })
    .finally(() => {
      inFlightRequests.delete(key);
    });

  inFlightRequests.set(key, promise);
  return (await promise) as T;
}

export function parseRepoInput(input: string): RepoRef | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const urlMatch = trimmed.match(
    /github\.com[/:](?<owner>[^/\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?(?:\/)?$/i,
  );

  if (urlMatch?.groups?.owner && urlMatch.groups.repo) {
    return {
      owner: urlMatch.groups.owner,
      name: urlMatch.groups.repo,
    };
  }

  const slugMatch = trimmed.match(/^(?<owner>[^/\s]+)\/(?<repo>[^/\s]+)$/);
  if (slugMatch?.groups?.owner && slugMatch.groups.repo) {
    return {
      owner: slugMatch.groups.owner,
      name: slugMatch.groups.repo,
    };
  }

  return null;
}

export async function getBranches(repo: RepoRef, token?: string) {
  return getGitHubBranches(repo, token, 20);
}

export async function getCommits(
  repo: RepoRef,
  branch: string,
  token?: string,
  perPage = 35,
) {
  return getGitHubCommits(repo, branch, token, perPage);
}

export async function getFileCommitHistory(
  repo: RepoRef,
  ref: string,
  path: string,
  token?: string,
  perPage = 10,
) {
  const normalizedPath = path.trim();
  const effectivePerPage = Math.max(perPage, 20);
  const cacheKey = `${repo.owner}/${repo.name}:file-history:${ref}:${normalizedPath}`;
  const commits = await getOrCreateRequest(cacheKey, async () => {
    return getGitHubFileHistory(repo, ref, normalizedPath, token, effectivePerPage);
  });

  return commits.slice(0, perPage);
}

export async function findIfcFiles(repo: RepoRef, sha: string, token?: string) {
  const entries = await getRepoTreeAtSha(repo, sha, token);

  return entries
    .filter((entry) => entry.type === "blob" && entry.path.toLowerCase().endsWith(".ifc"))
    .map<GitFileEntry>((entry) => ({
      path: entry.path,
      sha: entry.sha,
      size: entry.size,
    }));
}

export async function getRepoTreeAtSha(repo: RepoRef, sha: string, token?: string) {
  return getGitHubRepoTree(repo, sha, token);
}

export async function fetchIfcBuffer(
  repo: RepoRef,
  sha: string,
  path: string,
  token?: string,
) {
  return getGitHubFileBuffer(repo, sha, path, token);
}

export async function fetchRepoFileBuffer(
  repo: RepoRef,
  sha: string,
  path: string,
  token?: string,
) {
  return getGitHubFileBuffer(repo, sha, path, token);
}

export function mergeBranchCommits(branchCommits: Record<string, GitCommit[]>) {
  const merged = new Map<string, GitCommit>();

  Object.entries(branchCommits).forEach(([branchName, commits]) => {
    commits.forEach((commit) => {
      const existing = merged.get(commit.sha);
      if (existing) {
        existing.branchNames = Array.from(
          new Set([...existing.branchNames, branchName, ...commit.branchNames]),
        );
        return;
      }

      merged.set(commit.sha, {
        ...commit,
        branchNames: Array.from(new Set([branchName, ...commit.branchNames])),
      });
    });
  });

  return Array.from(merged.values()).sort(
    (left, right) =>
      new Date(right.authoredAt).getTime() - new Date(left.authoredAt).getTime(),
  );
}

export function getDefaultBranch(branches: GitBranch[]) {
  const preferred = ["main", "master", "develop"];
  return (
    preferred
      .map((name) => branches.find((branch) => branch.name === name))
      .find(Boolean) ?? branches[0] ?? null
  );
}

export function getStorageKey(repo: RepoRef, scope: string) {
  return `ifc-git-viewer:${repo.owner}/${repo.name}:${scope}`;
}
