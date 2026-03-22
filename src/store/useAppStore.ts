import { create } from "zustand";

import type { IfcDataStore } from "@ifc-lite/parser";

import { SAMPLE_REPO_URL } from "../lib/github";
import type { GitBranch, GitCommit, RepoRef } from "../types/git";
import type { IfcDiffResult, SelectedIfcEntity } from "../types/ifc";
import type { RepoFileNode } from "../types/repo";

interface AppState {
  repoInput: string;
  authToken: string;
  repo: RepoRef | null;
  branches: GitBranch[];
  selectedBranch: string | null;
  commits: GitCommit[];
  commitMap: Map<string, GitCommit>;
  repoTreeSha: string | null;
  repoFileTree: RepoFileNode[];
  repoFileMap: Map<string, RepoFileNode>;
  selectedFilePath: string | null;
  availableIfcPaths: string[];
  activeSha: string | null;
  activePath: string | null;
  prevSha: string | null;
  webGpuSupported: boolean;
  viewerReady: boolean;
  loading: boolean;
  loadProgress: number;
  loadError: string | null;
  entityCount: number;
  diffResult: IfcDiffResult | null;
  selectedExpressId: number | null;
  selectedEntity: SelectedIfcEntity | null;
  currentStore: IfcDataStore | null;
  previousStore: IfcDataStore | null;
  setRepoInput: (value: string) => void;
  setAuthToken: (value: string) => void;
  setRepoContext: (payload: {
    repo: RepoRef;
    branches: GitBranch[];
    selectedBranch: string | null;
    commits: GitCommit[];
    availableIfcPaths: string[];
    activeSha: string | null;
    activePath: string | null;
  }) => void;
  setSelectedBranch: (branch: string | null) => void;
  setCommits: (commits: GitCommit[]) => void;
  setRepoFileTree: (payload: {
    sha: string | null;
    tree: RepoFileNode[];
    fileMap: Map<string, RepoFileNode>;
    availableIfcPaths: string[];
    selectedFilePath?: string | null;
  }) => void;
  setAvailableIfcPaths: (paths: string[], activePath?: string | null) => void;
  setSelectedFilePath: (path: string | null) => void;
  setActivePath: (path: string | null) => void;
  setActiveSha: (sha: string | null) => void;
  setViewerFlags: (payload: Partial<Pick<AppState, "webGpuSupported" | "viewerReady">>) => void;
  setLoadState: (
    payload: Partial<Pick<AppState, "loading" | "loadProgress" | "loadError" | "entityCount">>,
  ) => void;
  setDiffResult: (diff: IfcDiffResult | null) => void;
  setSelectedExpressId: (expressId: number | null) => void;
  setSelectedEntity: (entity: SelectedIfcEntity | null) => void;
  setCurrentStore: (nextStore: IfcDataStore | null) => void;
  resetViewerState: () => void;
}

function buildCommitMap(commits: GitCommit[]) {
  return new Map(commits.map((commit) => [commit.sha, commit]));
}

export const useAppStore = create<AppState>((set) => ({
  repoInput: SAMPLE_REPO_URL,
  authToken: import.meta.env.VITE_GITHUB_TOKEN ?? "",
  repo: null,
  branches: [],
  selectedBranch: null,
  commits: [],
  commitMap: new Map(),
  repoTreeSha: null,
  repoFileTree: [],
  repoFileMap: new Map(),
  selectedFilePath: null,
  availableIfcPaths: [],
  activeSha: null,
  activePath: null,
  prevSha: null,
  webGpuSupported: true,
  viewerReady: false,
  loading: false,
  loadProgress: 0,
  loadError: null,
  entityCount: 0,
  diffResult: null,
  selectedExpressId: null,
  selectedEntity: null,
  currentStore: null,
  previousStore: null,
  setRepoInput: (value) => set({ repoInput: value }),
  setAuthToken: (value) => set({ authToken: value }),
  setRepoContext: ({ repo, branches, selectedBranch, commits, availableIfcPaths, activeSha, activePath }) =>
    set({
      repo,
      branches,
      selectedBranch,
      commits,
      commitMap: buildCommitMap(commits),
      repoTreeSha: activeSha,
      repoFileTree: [],
      repoFileMap: new Map(),
      selectedFilePath: activePath,
      availableIfcPaths,
      activeSha,
      activePath,
      prevSha: null,
      loadError: null,
      diffResult: null,
      selectedExpressId: null,
      selectedEntity: null,
      currentStore: null,
      previousStore: null,
    }),
  setSelectedBranch: (branch) => set({ selectedBranch: branch }),
  setCommits: (commits) => set({ commits, commitMap: buildCommitMap(commits) }),
  setRepoFileTree: ({ sha, tree, fileMap, availableIfcPaths, selectedFilePath = null }) =>
    set((state) => {
      const nextSelectedFilePath =
        selectedFilePath ??
        state.selectedFilePath ??
        state.activePath ??
        availableIfcPaths[0] ??
        null;

      const resolvedActivePath = nextSelectedFilePath ?? availableIfcPaths[0] ?? null;

      return {
        repoTreeSha: sha,
        repoFileTree: tree,
        repoFileMap: fileMap,
        selectedFilePath: nextSelectedFilePath,
        availableIfcPaths,
        activePath: resolvedActivePath,
      };
    }),
  setAvailableIfcPaths: (paths, activePath = null) =>
    set((state) => {
      const resolvedPath = activePath ?? paths[0] ?? null;

      return {
        availableIfcPaths: paths,
        selectedFilePath:
          state.selectedFilePath && paths.includes(state.selectedFilePath)
            ? state.selectedFilePath
            : resolvedPath,
        activePath: resolvedPath,
      };
    }),
  setSelectedFilePath: (path) =>
    set({
      selectedFilePath: path,
      activePath: path,
    }),
  setActivePath: (path) => set({ activePath: path }),
  setActiveSha: (sha) =>
    set((state) => ({
      activeSha: sha,
      prevSha: state.activeSha && state.activeSha !== sha ? state.activeSha : state.prevSha,
      selectedExpressId: null,
      selectedEntity: null,
    })),
  setViewerFlags: (payload) => set(payload),
  setLoadState: (payload) => set(payload),
  setDiffResult: (diff) => set({ diffResult: diff }),
  setSelectedExpressId: (expressId) => set({ selectedExpressId: expressId }),
  setSelectedEntity: (entity) =>
    set({
      selectedEntity: entity,
      selectedExpressId: entity?.expressId ?? null,
    }),
  setCurrentStore: (nextStore) =>
    set((state) => ({
      previousStore: state.currentStore,
      currentStore: nextStore,
      entityCount: nextStore?.entityCount ?? 0,
    })),
  resetViewerState: () =>
    set({
      loading: false,
      loadProgress: 0,
      loadError: null,
      entityCount: 0,
      diffResult: null,
      selectedExpressId: null,
      selectedEntity: null,
      currentStore: null,
      previousStore: null,
    }),
}));
