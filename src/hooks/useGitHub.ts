import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getBranches,
  getCommits,
  getDefaultBranch,
  getRepoTreeAtSha,
  SAMPLE_REPO,
  SAMPLE_REPO_URL,
  getStorageKey,
  mergeBranchCommits,
} from "../lib/github";
import { buildRepoFileTree } from "../lib/repoTree";
import { useAppStore } from "../store/useAppStore";
import type { GitBranch, GitCommit, RepoArtifactFile, RepoRef } from "../types/git";
import type { GitRepoTreeEntry } from "../types/repo";

interface UseGitHubResult {
  connectRepo: () => Promise<void>;
  selectBranch: (branchName: string) => Promise<void>;
  loadIfcPathsForSha: (sha: string) => Promise<string[]>;
  isConnecting: boolean;
  error: string | null;
}

function readCache<T>(key: string) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, value: T) {
  const payload = JSON.stringify({
    savedAt: Date.now(),
    value,
  });

  try {
    localStorage.setItem(key, payload);
  } catch {
    try {
      const cacheEntries = Object.keys(localStorage)
        .filter((entryKey) => entryKey.startsWith("ifc-git-viewer:"))
        .map((entryKey) => {
          const cached = readCache<{ savedAt?: number }>(entryKey);
          return {
            key: entryKey,
            savedAt: cached?.savedAt ?? 0,
          };
        })
        .sort((left, right) => left.savedAt - right.savedAt);

      for (const entry of cacheEntries.slice(0, 5)) {
        localStorage.removeItem(entry.key);
      }

      localStorage.setItem(key, payload);
    } catch {
      // Cache writes are optional; ignore storage quota issues.
    }
  }
}

function getCachedValue<T>(key: string, maxAgeMs = 5 * 60 * 1000) {
  const cached = readCache<{ savedAt: number; value: T }>(key);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.savedAt > maxAgeMs) {
    return null;
  }

  return cached.value;
}

async function loadBranchList(repo: RepoRef, token: string) {
  const cacheKey = getStorageKey(repo, "branches");
  const cached = getCachedValue<GitBranch[]>(cacheKey, 30 * 60 * 1000);
  if (cached) {
    return cached;
  }

  const branches = await getBranches(repo, token);
  writeCache(cacheKey, branches);
  return branches;
}

async function loadBranchCommits(repo: RepoRef, branch: string, token: string) {
  const cacheKey = getStorageKey(repo, `commits:${branch}`);
  const cached = getCachedValue<GitCommit[]>(cacheKey, 10 * 60 * 1000);
  if (cached) {
    return cached;
  }

  const commits = await getCommits(repo, branch, token);
  writeCache(cacheKey, commits);
  return commits;
}

async function loadIfcFiles(repo: RepoRef, sha: string, token: string) {
  const treeEntries = await loadRepoTree(repo, sha, token);
  return treeEntries
    .filter((entry) => entry.type === "blob" && entry.path.toLowerCase().endsWith(".ifc"))
    .map((entry) => entry.path);
}

async function loadRepoWideIfcFiles(repo: RepoRef, branches: GitBranch[], token: string) {
  const cacheKey = getStorageKey(repo, "ifc-catalog");
  const cached = getCachedValue<string[]>(cacheKey, 30 * 60 * 1000);
  if (cached) {
    return cached;
  }

  const pathSet = new Set<string>();

  await Promise.all(
    branches.map(async (branch) => {
      const branchPaths = await loadIfcFiles(repo, branch.sha, token);
      branchPaths.forEach((path) => pathSet.add(path));
    }),
  );

  const paths = Array.from(pathSet).sort((left, right) => left.localeCompare(right));
  writeCache(cacheKey, paths);
  return paths;
}

async function loadRepoWideBcfFiles(repo: RepoRef, branches: GitBranch[], token: string) {
  const cacheKey = getStorageKey(repo, "bcf-catalog:v2");
  const cached = getCachedValue<RepoArtifactFile[]>(cacheKey, 5 * 60 * 1000);
  if (cached) {
    return cached;
  }

  const files = new Map<string, RepoArtifactFile>();

  await Promise.all(
    branches.map(async (branch) => {
      const treeEntries = await loadRepoTree(repo, branch.sha, token);

      treeEntries
        .filter(
          (entry) =>
            entry.type === "blob" &&
            (entry.path.toLowerCase().endsWith(".bcfzip") || entry.path.toLowerCase().endsWith(".bcf")),
        )
        .forEach((entry) => {
          const existing = files.get(entry.path);
          if (existing) {
            return;
          }

          files.set(entry.path, {
            path: entry.path,
            sha: branch.sha,
            branch: branch.name,
            size: entry.size,
          });
        });
    }),
  );

  const results = Array.from(files.values()).sort((left, right) => right.path.localeCompare(left.path));
  writeCache(cacheKey, results);
  return results;
}

async function loadRepoTree(repo: RepoRef, sha: string, token: string) {
  const cacheKey = getStorageKey(repo, `tree:${sha}`);
  const cached = getCachedValue<GitRepoTreeEntry[]>(cacheKey, 30 * 60 * 1000);
  if (cached) {
    return cached;
  }

  const treeEntries = await getRepoTreeAtSha(repo, sha, token);
  writeCache(cacheKey, treeEntries);
  return treeEntries;
}

export function useGitHub(): UseGitHubResult {
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authToken = useAppStore((state) => state.authToken);
  const repo = useAppStore((state) => state.repo);
  const branches = useAppStore((state) => state.branches);
  const commits = useAppStore((state) => state.commits);
  const activeSha = useAppStore((state) => state.activeSha);
  const setRepoContext = useAppStore((state) => state.setRepoContext);
  const setCommits = useAppStore((state) => state.setCommits);
  const setSelectedBranch = useAppStore((state) => state.setSelectedBranch);
  const setAvailableIfcPaths = useAppStore((state) => state.setAvailableIfcPaths);
  const setActiveSha = useAppStore((state) => state.setActiveSha);
  const setLoadState = useAppStore((state) => state.setLoadState);
  const setAvailableBcfFiles = useAppStore((state) => state.setAvailableBcfFiles);
  const repoTreeSha = useAppStore((state) => state.repoTreeSha);
  const selectedFilePath = useAppStore((state) => state.selectedFilePath);
  const availableIfcPaths = useAppStore((state) => state.availableIfcPaths);
  const setRepoFileTree = useAppStore((state) => state.setRepoFileTree);

  const connectRepo = useCallback(async () => {
    setIsConnecting(true);
    setError(null);

    try {
      const branchList = await loadBranchList(SAMPLE_REPO, authToken);
      const prioritizedBranches = branchList.slice(0, 6);
      const commitsByBranch = Object.fromEntries(
        await Promise.all(
          prioritizedBranches.map(async (branch) => [
            branch.name,
            await loadBranchCommits(SAMPLE_REPO, branch.name, authToken),
          ]),
        ),
      );

      const mergedCommits = mergeBranchCommits(commitsByBranch);
      const defaultBranch = getDefaultBranch(branchList);
      const restoredActiveSha =
        activeSha && mergedCommits.some((commit) => commit.sha === activeSha)
          ? activeSha
          : defaultBranch?.sha ?? mergedCommits[0]?.sha ?? null;
      const repoTreeEntries = restoredActiveSha
        ? await loadRepoTree(SAMPLE_REPO, restoredActiveSha, authToken)
        : [];
      const { tree, fileMap } = buildRepoFileTree(repoTreeEntries);
      const [availableIfcPaths, availableBcfFiles] = await Promise.all([
        loadRepoWideIfcFiles(SAMPLE_REPO, branchList, authToken),
        loadRepoWideBcfFiles(SAMPLE_REPO, branchList, authToken),
      ]);

      setRepoContext({
        repo: SAMPLE_REPO,
        branches: branchList,
        selectedBranch: restoredActiveSha === defaultBranch?.sha ? defaultBranch?.name ?? null : null,
        commits: mergedCommits,
        availableIfcPaths,
        availableBcfFiles,
        activeSha: restoredActiveSha,
        activePath: availableIfcPaths[0] ?? null,
      });

      setRepoFileTree({
        sha: restoredActiveSha,
        tree,
        fileMap,
        availableIfcPaths,
      });
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : `Unable to connect to ${SAMPLE_REPO_URL}.`;
      setError(message);
      setLoadState({ loadError: message });
    } finally {
      setIsConnecting(false);
    }
  }, [activeSha, authToken, setLoadState, setRepoContext, setRepoFileTree]);

  const selectBranch = useCallback(
    async (branchName: string) => {
      if (!repo) {
        return;
      }

      setError(null);
      setSelectedBranch(branchName);

      try {
        const branch = branches.find((entry) => entry.name === branchName) ?? null;
        const branchCommits = await loadBranchCommits(repo, branchName, authToken);
        const mergedMap = new Map(commits.map((entry) => [entry.sha, entry] as const));

        branchCommits.forEach((commit) => {
          const existing = mergedMap.get(commit.sha);
          if (existing) {
            mergedMap.set(commit.sha, {
              ...existing,
              branchNames: Array.from(
                new Set([...existing.branchNames, ...commit.branchNames, branchName]),
              ),
            });
            return;
          }

          mergedMap.set(commit.sha, commit);
        });

        const mergedCommits = Array.from(mergedMap.values()).sort(
          (left, right) =>
            new Date(right.authoredAt).getTime() - new Date(left.authoredAt).getTime(),
        );
        const nextSha = branch?.sha ?? branchCommits[0]?.sha ?? null;
        const [nextIfcPaths, nextBcfFiles] = await Promise.all([
          loadRepoWideIfcFiles(repo, branches, authToken),
          loadRepoWideBcfFiles(repo, branches, authToken),
        ]);
        const nextTrackedPath =
          selectedFilePath && nextIfcPaths.includes(selectedFilePath)
            ? selectedFilePath
            : selectedFilePath
              ? null
              : nextIfcPaths[0] ?? null;

        setCommits(mergedCommits);
        setAvailableIfcPaths(nextIfcPaths, nextTrackedPath);
        setAvailableBcfFiles(nextBcfFiles);
        setActiveSha(nextSha);
      } catch (caughtError) {
        const message =
          caughtError instanceof Error ? caughtError.message : "Unable to switch branches.";
        setError(message);
      }
    },
    [
      authToken,
      branches,
      commits,
      repo,
      selectedFilePath,
      setActiveSha,
      setAvailableIfcPaths,
      setAvailableBcfFiles,
      setCommits,
      setSelectedBranch,
    ],
  );

  const loadIfcPathsForSha = useCallback(
    async (sha: string) => {
      if (!repo) {
        return [];
      }

      return loadIfcFiles(repo, sha, authToken);
    },
    [authToken, repo],
  );

  useEffect(() => {
    if (!repo || !activeSha) {
      return;
    }

    const repoRef = repo;
    const activeShaRef = activeSha;
    if (repoTreeSha === activeShaRef) {
      return;
    }

    let cancelled = false;

    async function syncRepoTree() {
      try {
        const entries = await loadRepoTree(repoRef, activeShaRef, authToken);
        if (cancelled) {
          return;
        }

        const { tree, fileMap } = buildRepoFileTree(entries);
        const nextSelectedFilePath =
          selectedFilePath && availableIfcPaths.includes(selectedFilePath)
            ? selectedFilePath
            : selectedFilePath
              ? null
              : availableIfcPaths[0] ?? null;

        setRepoFileTree({
          sha: activeShaRef,
          tree,
          fileMap,
          availableIfcPaths,
          selectedFilePath: nextSelectedFilePath,
        });
      } catch (caughtError) {
        const message =
          caughtError instanceof Error ? caughtError.message : "Unable to load repository files.";
        setLoadState({ loadError: message });
      }
    }

    void syncRepoTree();

    return () => {
      cancelled = true;
    };
  }, [
    activeSha,
    authToken,
    availableIfcPaths,
    repo,
    repoTreeSha,
    selectedFilePath,
    setLoadState,
    setRepoFileTree,
  ]);

  return useMemo(
    () => ({
      connectRepo,
      selectBranch,
      loadIfcPathsForSha,
      isConnecting,
      error,
    }),
    [connectRepo, error, isConnecting, loadIfcPathsForSha, selectBranch],
  );
}
