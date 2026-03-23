import { create } from "zustand";

import type { IfcDataStore } from "@ifc-lite/parser";

import { SAMPLE_REPO_URL } from "../lib/github";
import type {
  BCFProject,
  BcfViewerBridge,
  ViewerBounds,
  ViewerCameraState,
  ViewerSectionPlane,
} from "../types/bcf";
import type { GitBranch, GitCommit, RepoArtifactFile, RepoRef } from "../types/git";
import type {
  BackendVersion,
  IfcDiffResult,
  QueryComponentRecord,
  QueryExplorerFilters,
  SelectedIfcEntity,
} from "../types/ifc";
import type { RepoFileNode } from "../types/repo";

const LAST_MODEL_PATH_STORAGE_KEY = "ifc-git-viewer:last-model-path";
const LAST_ACTIVE_SHA_STORAGE_KEY = "ifc-git-viewer:last-active-sha";

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
  availableBcfFiles: RepoArtifactFile[];
  activeSha: string | null;
  activePath: string | null;
  prevSha: string | null;
  bcfProject: BCFProject | null;
  bcfSourceName: string | null;
  bcfDirty: boolean;
  selectedTopicGuid: string | null;
  selectedViewpointGuid: string | null;
  viewerApi: BcfViewerBridge | null;
  viewerCamera: ViewerCameraState | null;
  viewerBounds: ViewerBounds | null;
  activeSectionPlane: ViewerSectionPlane | null;
  viewerHiddenExpressIds: Set<number>;
  viewerIsolatedExpressIds: Set<number> | null;
  viewerColoredExpressIds: Map<number, [number, number, number, number]>;
  webGpuSupported: boolean;
  viewerReady: boolean;
  loading: boolean;
  loadProgress: number;
  loadError: string | null;
  entityCount: number;
  diffHighlightEnabled: boolean;
  diffGhostNonAffectedEnabled: boolean;
  diffResult: IfcDiffResult | null;
  queryVersions: BackendVersion[];
  selectedQueryVersion: string | null;
  queryTypes: string[];
  queryFilters: QueryExplorerFilters;
  queryResults: QueryComponentRecord[];
  queryResultCount: number;
  queryResultTruncated: boolean;
  queryLoading: boolean;
  queryError: string | null;
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
    availableBcfFiles: RepoArtifactFile[];
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
  setAvailableBcfFiles: (files: RepoArtifactFile[]) => void;
  setAvailableIfcPaths: (paths: string[], activePath?: string | null) => void;
  setSelectedFilePath: (path: string | null) => void;
  setActivePath: (path: string | null) => void;
  setActiveSha: (sha: string | null) => void;
  setBcfProject: (project: BCFProject | null, sourceName?: string | null) => void;
  markBcfDirty: (dirty: boolean) => void;
  setSelectedTopicGuid: (guid: string | null) => void;
  setSelectedViewpointGuid: (guid: string | null) => void;
  setViewerApi: (viewerApi: BcfViewerBridge | null) => void;
  setViewerCamera: (camera: ViewerCameraState | null) => void;
  setViewerBounds: (bounds: ViewerBounds | null) => void;
  setActiveSectionPlane: (sectionPlane: ViewerSectionPlane | null) => void;
  setViewerHiddenExpressIds: (ids: Set<number>) => void;
  setViewerIsolatedExpressIds: (ids: Set<number> | null) => void;
  setViewerColoredExpressIds: (ids: Map<number, [number, number, number, number]>) => void;
  setViewerFlags: (payload: Partial<Pick<AppState, "webGpuSupported" | "viewerReady">>) => void;
  setLoadState: (
    payload: Partial<Pick<AppState, "loading" | "loadProgress" | "loadError" | "entityCount">>,
  ) => void;
  setDiffHighlightEnabled: (enabled: boolean) => void;
  setDiffGhostNonAffectedEnabled: (enabled: boolean) => void;
  setDiffResult: (diff: IfcDiffResult | null) => void;
  setQueryExplorerState: (
    payload: Partial<
      Pick<
        AppState,
        | "queryVersions"
        | "selectedQueryVersion"
        | "queryTypes"
        | "queryResults"
        | "queryResultCount"
        | "queryResultTruncated"
        | "queryLoading"
        | "queryError"
      >
    >,
  ) => void;
  setQueryFilters: (payload: Partial<QueryExplorerFilters>) => void;
  setSelectedExpressId: (expressId: number | null) => void;
  setSelectedEntity: (entity: SelectedIfcEntity | null) => void;
  setCurrentStore: (nextStore: IfcDataStore | null) => void;
  resetViewerState: () => void;
}

function buildCommitMap(commits: GitCommit[]) {
  return new Map(commits.map((commit) => [commit.sha, commit]));
}

function readLastModelPath() {
  try {
    return localStorage.getItem(LAST_MODEL_PATH_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistLastModelPath(path: string | null) {
  try {
    if (path) {
      localStorage.setItem(LAST_MODEL_PATH_STORAGE_KEY, path);
      return;
    }

    localStorage.removeItem(LAST_MODEL_PATH_STORAGE_KEY);
  } catch {
    // Persisting the user's last model selection is optional.
  }
}

function readLastActiveSha() {
  try {
    return localStorage.getItem(LAST_ACTIVE_SHA_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistLastActiveSha(sha: string | null) {
  try {
    if (sha) {
      localStorage.setItem(LAST_ACTIVE_SHA_STORAGE_KEY, sha);
      return;
    }

    localStorage.removeItem(LAST_ACTIVE_SHA_STORAGE_KEY);
  } catch {
    // Persisting the user's last active commit is optional.
  }
}

export const useAppStore = create<AppState>((set) => ({
  repoInput: SAMPLE_REPO_URL,
  authToken: "",
  repo: null,
  branches: [],
  selectedBranch: null,
  commits: [],
  commitMap: new Map(),
  repoTreeSha: null,
  repoFileTree: [],
  repoFileMap: new Map(),
  selectedFilePath: readLastModelPath(),
  availableIfcPaths: [],
  availableBcfFiles: [],
  activeSha: readLastActiveSha(),
  activePath: null,
  prevSha: null,
  bcfProject: null,
  bcfSourceName: null,
  bcfDirty: false,
  selectedTopicGuid: null,
  selectedViewpointGuid: null,
  viewerApi: null,
  viewerCamera: null,
  viewerBounds: null,
  activeSectionPlane: null,
  viewerHiddenExpressIds: new Set(),
  viewerIsolatedExpressIds: null,
  viewerColoredExpressIds: new Map(),
  webGpuSupported: true,
  viewerReady: false,
  loading: false,
  loadProgress: 0,
  loadError: null,
  entityCount: 0,
  diffHighlightEnabled: true,
  diffGhostNonAffectedEnabled: false,
  diffResult: null,
  queryVersions: [],
  selectedQueryVersion: null,
  queryTypes: [],
  queryFilters: {
    type: null,
  },
  queryResults: [],
  queryResultCount: 0,
  queryResultTruncated: false,
  queryLoading: false,
  queryError: null,
  selectedExpressId: null,
  selectedEntity: null,
  currentStore: null,
  previousStore: null,
  setRepoInput: (value) => set({ repoInput: value }),
  setAuthToken: (value) => set({ authToken: value }),
  setRepoContext: ({
    repo,
    branches,
    selectedBranch,
    commits,
    availableIfcPaths,
    availableBcfFiles,
    activeSha,
    activePath,
  }) =>
    set((state) => {
      const persistedPath = readLastModelPath();
      const persistedSha = readLastActiveSha();
      const nextActiveSha =
        (persistedSha && commits.some((commit) => commit.sha === persistedSha) ? persistedSha : null) ??
        activeSha;
      const nextSelectedFilePath =
        (persistedPath && availableIfcPaths.includes(persistedPath) ? persistedPath : null) ??
        (state.selectedFilePath && availableIfcPaths.includes(state.selectedFilePath)
          ? state.selectedFilePath
          : null) ??
        activePath;

      persistLastModelPath(nextSelectedFilePath);
      persistLastActiveSha(nextActiveSha);

      return {
        repo,
        branches,
        selectedBranch,
        commits,
        commitMap: buildCommitMap(commits),
        repoTreeSha: nextActiveSha,
        repoFileTree: [],
        repoFileMap: new Map(),
        selectedFilePath: nextSelectedFilePath,
        availableIfcPaths,
        availableBcfFiles,
        activeSha: nextActiveSha,
        activePath: nextSelectedFilePath,
        prevSha: null,
        loadError: null,
        diffResult: null,
        selectedExpressId: null,
        selectedEntity: null,
        currentStore: null,
        previousStore: null,
        viewerBounds: null,
        viewerCamera: null,
        activeSectionPlane: null,
        viewerHiddenExpressIds: new Set(),
        viewerIsolatedExpressIds: null,
        viewerColoredExpressIds: new Map(),
        selectedViewpointGuid: null,
      };
    }),
  setSelectedBranch: (branch) => set({ selectedBranch: branch }),
  setCommits: (commits) => set({ commits, commitMap: buildCommitMap(commits) }),
  setRepoFileTree: ({ sha, tree, fileMap, availableIfcPaths, selectedFilePath = null }) =>
    set((state) => {
      const persistedPath = readLastModelPath();
      const nextSelectedFilePath =
        selectedFilePath ??
        (persistedPath && availableIfcPaths.includes(persistedPath) ? persistedPath : null) ??
        (state.selectedFilePath && availableIfcPaths.includes(state.selectedFilePath)
          ? state.selectedFilePath
          : null) ??
        (state.activePath && availableIfcPaths.includes(state.activePath) ? state.activePath : null) ??
        availableIfcPaths[0] ??
        null;

      const resolvedActivePath = nextSelectedFilePath ?? availableIfcPaths[0] ?? null;
      persistLastModelPath(resolvedActivePath);

      return {
        repoTreeSha: sha,
        repoFileTree: tree,
        repoFileMap: fileMap,
        selectedFilePath: nextSelectedFilePath,
        availableIfcPaths,
        activePath: resolvedActivePath,
      };
    }),
  setAvailableBcfFiles: (files) => set({ availableBcfFiles: files }),
  setAvailableIfcPaths: (paths, activePath = null) =>
    set((state) => {
      const persistedPath = readLastModelPath();
      const resolvedPath =
        (activePath && paths.includes(activePath) ? activePath : null) ??
        (persistedPath && paths.includes(persistedPath) ? persistedPath : null) ??
        (state.selectedFilePath && paths.includes(state.selectedFilePath)
          ? state.selectedFilePath
          : null) ??
        paths[0] ??
        null;

      persistLastModelPath(resolvedPath);

      return {
        availableIfcPaths: paths,
        selectedFilePath: resolvedPath,
        activePath: resolvedPath,
      };
    }),
  setSelectedFilePath: (path) =>
    set(() => {
      persistLastModelPath(path);
      return {
        selectedFilePath: path,
        activePath: path,
      };
    }),
  setActivePath: (path) => set({ activePath: path }),
  setActiveSha: (sha) =>
    set((state) => {
      persistLastActiveSha(sha);
      return {
        activeSha: sha,
        prevSha: state.activeSha && state.activeSha !== sha ? state.activeSha : state.prevSha,
        selectedExpressId: null,
        selectedEntity: null,
      };
    }),
  setBcfProject: (project, sourceName = null) =>
    set((state) => {
      const topicEntries = project ? Array.from(project.topics.keys()) : [];
      const nextSelectedTopicGuid =
        state.selectedTopicGuid && topicEntries.includes(state.selectedTopicGuid)
          ? state.selectedTopicGuid
          : topicEntries[0] ?? null;
      const selectedTopic = nextSelectedTopicGuid ? project?.topics.get(nextSelectedTopicGuid) ?? null : null;
      const nextSelectedViewpointGuid =
        (selectedTopic && state.selectedViewpointGuid
          ? selectedTopic.viewpoints.find((viewpoint) => viewpoint.guid === state.selectedViewpointGuid)?.guid ?? null
          : null) ??
        selectedTopic?.viewpoints[0]?.guid ??
        null;

      return {
        bcfProject: project,
        bcfSourceName: sourceName,
        bcfDirty: false,
        selectedTopicGuid: nextSelectedTopicGuid,
        selectedViewpointGuid: nextSelectedViewpointGuid,
      };
    }),
  markBcfDirty: (dirty) => set({ bcfDirty: dirty }),
  setSelectedTopicGuid: (guid) =>
    set((state) => {
      const topic = guid ? state.bcfProject?.topics.get(guid) ?? null : null;
      return {
        selectedTopicGuid: guid,
        selectedViewpointGuid: topic?.viewpoints[0]?.guid ?? null,
      };
    }),
  setSelectedViewpointGuid: (guid) => set({ selectedViewpointGuid: guid }),
  setViewerApi: (viewerApi) => set({ viewerApi }),
  setViewerCamera: (camera) => set({ viewerCamera: camera }),
  setViewerBounds: (bounds) => set({ viewerBounds: bounds }),
  setActiveSectionPlane: (sectionPlane) => set({ activeSectionPlane: sectionPlane }),
  setViewerHiddenExpressIds: (ids) => set({ viewerHiddenExpressIds: new Set(ids) }),
  setViewerIsolatedExpressIds: (ids) => set({ viewerIsolatedExpressIds: ids ? new Set(ids) : null }),
  setViewerColoredExpressIds: (ids) => set({ viewerColoredExpressIds: new Map(ids) }),
  setViewerFlags: (payload) => set(payload),
  setLoadState: (payload) => set(payload),
  setDiffHighlightEnabled: (enabled) => set({ diffHighlightEnabled: enabled }),
  setDiffGhostNonAffectedEnabled: (enabled) => set({ diffGhostNonAffectedEnabled: enabled }),
  setDiffResult: (diff) => set({ diffResult: diff }),
  setQueryExplorerState: (payload) => set(payload),
  setQueryFilters: (payload) =>
    set((state) => ({
      queryFilters: {
        ...state.queryFilters,
        ...payload,
      },
    })),
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
      queryResults: [],
      queryResultCount: 0,
      queryResultTruncated: false,
      queryError: null,
      selectedExpressId: null,
      selectedEntity: null,
      currentStore: null,
      previousStore: null,
      viewerBounds: null,
      viewerCamera: null,
      activeSectionPlane: null,
      viewerHiddenExpressIds: new Set(),
      viewerIsolatedExpressIds: null,
      viewerColoredExpressIds: new Map(),
      selectedViewpointGuid: null,
    }),
}));
