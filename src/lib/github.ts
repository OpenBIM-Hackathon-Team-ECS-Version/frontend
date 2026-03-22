import { Octokit } from "@octokit/rest";

import type { GitBranch, GitCommit, GitFileEntry, RepoRef } from "../types/git";
import type { GitRepoTreeEntry } from "../types/repo";

export const SAMPLE_REPO_URL =
  "https://github.com/OpenBIM-Hackathon-Team-ECS-Version/Sample-IFC-Files";
export const SAMPLE_REPO: RepoRef = {
  owner: "OpenBIM-Hackathon-Team-ECS-Version",
  name: "Sample-IFC-Files",
};

function createOctokit(token?: string) {
  return new Octokit({
    auth: token?.trim() ? token.trim() : undefined,
  });
}

const relativeFormatter = new Intl.RelativeTimeFormat("en", {
  numeric: "auto",
});

function formatRelativeTime(isoDate: string) {
  const diffMs = new Date(isoDate).getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);

  if (Math.abs(diffMinutes) < 60) {
    return relativeFormatter.format(diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return relativeFormatter.format(diffHours, "hour");
  }

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) {
    return relativeFormatter.format(diffDays, "day");
  }

  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) {
    return relativeFormatter.format(diffMonths, "month");
  }

  const diffYears = Math.round(diffMonths / 12);
  return relativeFormatter.format(diffYears, "year");
}

function normalizeBranchName(name: string) {
  return name.trim();
}

function toShortSha(sha: string) {
  return sha.slice(0, 7);
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
  const octokit = createOctokit(token);
  const { data } = await octokit.repos.listBranches({
    owner: repo.owner,
    repo: repo.name,
    per_page: 20,
  });

  return data.map<GitBranch>((branch) => ({
    name: normalizeBranchName(branch.name),
    sha: branch.commit.sha,
    protected: branch.protected,
  }));
}

export async function getCommits(
  repo: RepoRef,
  branch: string,
  token?: string,
  perPage = 35,
) {
  const octokit = createOctokit(token);
  const { data } = await octokit.repos.listCommits({
    owner: repo.owner,
    repo: repo.name,
    sha: branch,
    per_page: perPage,
  });

  return data.map<GitCommit>((commit) => {
    const authoredAt =
      commit.commit.author?.date ??
      commit.commit.committer?.date ??
      new Date().toISOString();

    return {
      sha: commit.sha,
      shortSha: toShortSha(commit.sha),
      message: commit.commit.message,
      authoredAt,
      relativeTime: formatRelativeTime(authoredAt),
      authorName:
        commit.commit.author?.name ??
        commit.author?.login ??
        commit.commit.committer?.name ??
        "Unknown author",
      authorAvatarUrl: commit.author?.avatar_url ?? null,
      parentShas: commit.parents.map((parent) => parent.sha),
      branchNames: [branch],
    };
  });
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
  const octokit = createOctokit(token);
  const { data } = await octokit.git.getTree({
    owner: repo.owner,
    repo: repo.name,
    tree_sha: sha,
    recursive: "true",
  });

  return data.tree
    .filter(
      (entry): entry is typeof entry & { path: string; sha: string } =>
        (entry.type === "blob" || entry.type === "tree") &&
        typeof entry.path === "string" &&
        typeof entry.sha === "string",
    )
    .map<GitRepoTreeEntry>((entry) => ({
      path: entry.path,
      sha: entry.sha,
      type: entry.type as "blob" | "tree",
      size: entry.size,
    }));
}

function decodeBase64ToArrayBuffer(content: string) {
  const binary = atob(content.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

export async function fetchIfcBuffer(
  repo: RepoRef,
  sha: string,
  path: string,
  token?: string,
) {
  if (token?.trim()) {
    const octokit = createOctokit(token);
    const { data } = await octokit.repos.getContent({
      owner: repo.owner,
      repo: repo.name,
      path,
      ref: sha,
      headers: {
        accept: "application/vnd.github.raw+json",
      },
    });

    if (typeof data === "object" && "content" in data && typeof data.content === "string") {
      return decodeBase64ToArrayBuffer(data.content);
    }
  }

  const url = `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${sha}/${path}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch IFC file (${response.status})`);
  }

  return response.arrayBuffer();
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
