import type { Node } from "@xyflow/react";

export interface RepoRef {
  owner: string;
  name: string;
}

export interface GitBranch {
  name: string;
  sha: string;
  protected?: boolean;
}

export interface GitCommit {
  sha: string;
  shortSha: string;
  message: string;
  authoredAt: string;
  relativeTime: string;
  authorName: string;
  authorAvatarUrl: string | null;
  branchNames: string[];
  parentShas: string[];
}

export interface GitFileEntry {
  path: string;
  sha: string;
  size?: number;
}

export interface RepoArtifactFile {
  path: string;
  sha: string;
  branch: string;
  size?: number;
}

export interface GitGraphNodeData extends Record<string, unknown> {
  sha: string;
  message: string;
  authorName: string;
  relativeTime: string;
  branchNames: string[];
  isHead: boolean;
  isRelevant: boolean;
}

export interface BranchNodeData extends Record<string, unknown> {
  name: string;
}

export type CommitFlowNode = Node<GitGraphNodeData, "commit">;
export type BranchFlowNode = Node<BranchNodeData, "branch">;
