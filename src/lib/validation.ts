import type { RepoRef } from "../types/git";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim() || "http://localhost:5001";

export interface ValidationResult {
  file_name: string;
  commit: string;
  schema: boolean;
  syntax: boolean;
  normative: boolean;
  industry_practices: boolean;
  cached?: boolean;
}

export function isAllPassing(result: ValidationResult): boolean {
  return result.schema && result.syntax && result.normative && result.industry_practices;
}

export async function validateFile(
  repo: RepoRef,
  commitSha: string,
  filePath: string,
): Promise<ValidationResult> {
  const res = await fetch(`${API_BASE_URL}/api/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repoOwner: repo.owner,
      repoName: repo.name,
      commitSha,
      filePath,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => `Request failed (${res.status})`);
    throw new Error(text);
  }

  return res.json() as Promise<ValidationResult>;
}

export async function fetchValidationBcf(
  repo: RepoRef,
  commitSha: string,
  filePath: string,
): Promise<ArrayBuffer> {
  const res = await fetch(`${API_BASE_URL}/api/validate?format=bcf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repoOwner: repo.owner,
      repoName: repo.name,
      commitSha,
      filePath,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => `Request failed (${res.status})`);
    throw new Error(text);
  }

  return res.arrayBuffer();
}
