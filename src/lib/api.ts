import type { RepoRef } from "../types/git";
import type { IfcDiffResult } from "../types/ifc";

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
  const response = await fetch(`${API_BASE_URL}/api/ifc/diff`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      current: toRequestRef(params.repo, params.currentSha, params.filePath),
      last: toRequestRef(params.repo, params.lastSha, params.filePath),
      githubToken: params.githubToken?.trim() ? params.githubToken.trim() : undefined,
    }),
  });

  const data = (await response.json()) as unknown;
  if (!response.ok) {
    const errorMessage =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `Failed to diff IFC revisions (${response.status})`;
    throw new Error(errorMessage);
  }

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
  };
}
