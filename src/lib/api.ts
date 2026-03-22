import type { GitBranch, GitCommit, RepoRef } from "../types/git";
import type {
  BackendVersion,
  IfcDiffDetail,
  IfcDiffResult,
  QueryComponentRecord,
} from "../types/ifc";
import type { GitRepoTreeEntry } from "../types/repo";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim() || "http://localhost:5001";

interface IfcDiffRequestRef {
  repoOwner: string;
  repoName: string;
  commitSha: string;
  filePath: string;
  githubUrl: string;
}

interface IfcDiffApiResponse {
  baseSha: string;
  compareSha: string;
  summary: {
    added: number;
    changed: number;
    deleted: number;
  };
  added: string[];
  changed: string[];
  deleted: string[];
  changesById: Record<string, { type: string; fields: string[] }>;
  detailsById?: Record<
    string,
    {
      globalId: string;
      status: "added" | "changed" | "deleted";
      type: string;
      previousType?: string | null;
      name: string | null;
      description: string | null;
      objectType: string | null;
      tag: string | null;
      changedFields: string[];
    }
  >;
}

interface VersionsApiResponse {
  latest: string | null;
  versions: BackendVersion[];
}

function buildUrl(path: string, params?: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value === undefined || value === "") {
      return;
    }
    query.set(key, String(value));
  });

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const suffix = query.toString() ? `?${query.toString()}` : "";

  if (/^https?:\/\//i.test(API_BASE_URL)) {
    const url = new URL(normalizedPath, API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`);
    return `${url.toString()}${suffix ? suffix.replace(/^\?/, url.search ? "&" : "?") : ""}`;
  }

  const normalizedBase = API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  return `${normalizedBase}${normalizedPath}${suffix}`;
}

async function readError(response: Response) {
  try {
    const data = (await response.json()) as unknown;
    if (data && typeof data === "object" && "error" in data && typeof data.error === "string") {
      return data.error;
    }
  } catch {
    // Fall back to text below.
  }

  try {
    const text = await response.text();
    return text || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

async function requestJson<T>(
  path: string,
  options?: {
    body?: unknown;
    method?: string;
    params?: Record<string, string | number | undefined>;
    token?: string;
  },
) {
  const response = await fetch(buildUrl(path, options?.params), {
    method: options?.method ?? (options?.body ? "POST" : "GET"),
    headers: {
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...(options?.token?.trim() ? { "X-GitHub-Token": options.token.trim() } : {}),
    },
    ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as T;
}

async function requestBuffer(
  path: string,
  options?: {
    params?: Record<string, string | number | undefined>;
    token?: string;
  },
) {
  const response = await fetch(buildUrl(path, options?.params), {
    headers: options?.token?.trim() ? { "X-GitHub-Token": options.token.trim() } : {},
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return response.arrayBuffer();
}

function isIfcDiffApiResponse(value: unknown): value is IfcDiffApiResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<IfcDiffApiResponse>;
  return (
    typeof candidate.baseSha === "string" &&
    typeof candidate.compareSha === "string" &&
    Array.isArray(candidate.added) &&
    Array.isArray(candidate.changed) &&
    Array.isArray(candidate.deleted)
  );
}

function toRequestRef(repo: RepoRef, commitSha: string, filePath: string): IfcDiffRequestRef {
  const normalizedPath = filePath.replace(/^\/+/, "");
  return {
    repoOwner: repo.owner,
    repoName: repo.name,
    commitSha,
    filePath: normalizedPath,
    githubUrl: `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${commitSha}/${normalizedPath}`,
  };
}

export async function getIfcDiff(params: {
  repo: RepoRef;
  currentSha: string;
  lastSha: string;
  filePath: string;
  githubToken?: string;
}): Promise<IfcDiffResult> {
  const data = await requestJson<IfcDiffApiResponse>("/api/ifc/diff", {
    method: "POST",
    token: params.githubToken,
    body: {
      current: toRequestRef(params.repo, params.currentSha, params.filePath),
      last: toRequestRef(params.repo, params.lastSha, params.filePath),
      githubToken: params.githubToken?.trim() ? params.githubToken.trim() : undefined,
    },
  });

  if (!isIfcDiffApiResponse(data)) {
    throw new Error("Backend returned an invalid IFC diff payload.");
  }

  return {
    baseSha: data.baseSha,
    compareSha: data.compareSha,
    added: new Set(data.added),
    changed: new Set(data.changed),
    deleted: new Set(data.deleted),
    changesById: data.changesById ?? {},
    detailsById: data.detailsById ?? {},
  };
}

export function getGitHubBranches(repo: RepoRef, githubToken?: string, perPage = 20) {
  return requestJson<GitBranch[]>("/api/github/branches", {
    params: {
      owner: repo.owner,
      repo: repo.name,
      perPage,
    },
    token: githubToken,
  });
}

export function getGitHubCommits(repo: RepoRef, ref: string, githubToken?: string, perPage = 35) {
  return requestJson<GitCommit[]>("/api/github/commits", {
    params: {
      owner: repo.owner,
      repo: repo.name,
      ref,
      perPage,
    },
    token: githubToken,
  });
}

export function getGitHubFileHistory(
  repo: RepoRef,
  ref: string,
  filePath: string,
  githubToken?: string,
  perPage = 10,
) {
  return requestJson<GitCommit[]>("/api/github/file-history", {
    params: {
      owner: repo.owner,
      repo: repo.name,
      ref,
      path: filePath,
      perPage,
    },
    token: githubToken,
  });
}

export function getGitHubRepoTree(repo: RepoRef, sha: string, githubToken?: string) {
  return requestJson<GitRepoTreeEntry[]>("/api/github/tree", {
    params: {
      owner: repo.owner,
      repo: repo.name,
      ref: sha,
    },
    token: githubToken,
  });
}

export function getGitHubFileBuffer(
  repo: RepoRef,
  ref: string,
  filePath: string,
  githubToken?: string,
) {
  return requestBuffer("/api/github/file", {
    params: {
      owner: repo.owner,
      repo: repo.name,
      ref,
      path: filePath,
    },
    token: githubToken,
  });
}

export function getGitHubComponentDetails(
  repo: RepoRef,
  ref: string,
  filePath: string,
  guids: string[],
  githubToken?: string,
) {
  return requestJson<Record<string, IfcDiffDetail>>("/api/github/components", {
    params: {
      owner: repo.owner,
      repo: repo.name,
      ref,
      path: filePath,
      guids: guids.join(","),
    },
    token: githubToken,
  });
}

function joinCsv(values?: string[] | null) {
  if (!values || values.length === 0) {
    return undefined;
  }

  return values.join(",");
}

export function getVersions(limit = 20) {
  return requestJson<VersionsApiResponse>("/api/versions", {
    params: { limit },
  });
}

export function getEntityTypes(models?: string[], version?: string | null) {
  return requestJson<string[]>("/api/entityTypes", {
    params: {
      models: joinCsv(models),
      version: version ?? undefined,
    },
  });
}

export function getComponentTypes(models?: string[], version?: string | null) {
  return requestJson<string[]>("/api/componentTypes", {
    params: {
      models: joinCsv(models),
      version: version ?? undefined,
    },
  });
}

export function getComponentGuids(params: {
  models?: string[];
  entityGuids?: string[];
  entityTypes?: string[];
  componentTypes?: string[];
  version?: string | null;
}) {
  return requestJson<Record<string, string[]>>("/api/componentGuids", {
    params: {
      models: joinCsv(params.models),
      entityGuids: joinCsv(params.entityGuids),
      entityTypes: joinCsv(params.entityTypes),
      componentTypes: joinCsv(params.componentTypes),
      version: params.version ?? undefined,
    },
  });
}

export function getComponents(params: {
  componentGuids?: string[];
  models?: string[];
  entityTypes?: string[];
  entityGuids?: string[];
  componentTypes?: string[];
  version?: string | null;
}) {
  return requestJson<Record<string, QueryComponentRecord[]>>("/api/components", {
    params: {
      componentGuids: joinCsv(params.componentGuids),
      models: joinCsv(params.models),
      entityTypes: joinCsv(params.entityTypes),
      entityGuids: joinCsv(params.entityGuids),
      componentTypes: joinCsv(params.componentTypes),
      version: params.version ?? undefined,
    },
  });
}
