export interface GitRepoTreeEntry {
  path: string;
  sha: string;
  type: "blob" | "tree";
  size?: number;
}

export interface RepoFileNode {
  path: string;
  name: string;
  type: "file" | "dir";
  extension?: string;
  sha?: string;
  size?: number;
  children?: RepoFileNode[];
}
