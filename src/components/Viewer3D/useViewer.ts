import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";

import {
  extractAllEntityAttributes,
  extractEntityAttributesOnDemand,
  extractPropertiesOnDemand,
  extractQuantitiesOnDemand,
  IfcParser,
  type IfcDataStore,
} from "@ifc-lite/parser";
import { GeometryProcessor, type GeometryResult } from "@ifc-lite/geometry";
import { Renderer, type ProjectionMode } from "@ifc-lite/renderer";

import type { Theme } from "../../hooks/useTheme";
import {
  colorOverridesToGuids,
  getGuidForExpressId,
  importBcfProject,
  mapGuidsToExpressIds,
} from "../../lib/bcf";
import {
  buildTopicHistoryByGuid,
  buildTopicLifecycle,
  getTopicStateAtCommit,
  resolveTopicCommitSha,
  type TopicHistoryMap,
} from "../../lib/bcfTimeline";
import { BCFOverlayRenderer, computeMarkerPositions } from "../../lib/bcfOverlay";
import { fetchRepoFileBuffer, getFileCommitHistory, mergeBranchCommits } from "../../lib/github";
import { useAppStore } from "../../store/useAppStore";
import type {
  BCFMarker3D,
  BCFProject,
  BCFTopic,
  BcfViewerBridge,
  BCFOverlayProjection,
  ViewerBounds,
  ViewerCameraState,
  ViewerSectionPlane,
} from "../../types/bcf";
import type { GitCommit } from "../../types/git";
import type { IfcDiffResult, IfcPropertyGroup, SelectedIfcEntity } from "../../types/ifc";

const MAX_RENDER_DIMENSION = 4096;
const DIFF_COLORS = {
  added: [0.07, 0.77, 0.45, 1] as [number, number, number, number],
  changed: [1, 0.86, 0.2, 1] as [number, number, number, number],
};
const DIFF_GHOST_ALPHA = 0.14;

function getClearColor(theme: Theme): [number, number, number, number] {
  return theme === "light" ? [0.945, 0.961, 0.976, 1] : [0.09, 0.11, 0.16, 1];
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildPropertyGroups(store: IfcDataStore, expressId: number): IfcPropertyGroup[] {
  const propertySets = extractPropertiesOnDemand(store, expressId);
  return propertySets.map((group) => ({
    name: group.name,
    entries: group.properties.map((property) => ({
      name: property.name,
      value: formatValue(property.value),
    })),
  }));
}

function buildQuantityGroups(store: IfcDataStore, expressId: number): IfcPropertyGroup[] {
  const quantitySets = extractQuantitiesOnDemand(store, expressId);
  return quantitySets.map((group) => ({
    name: group.name,
    entries: group.quantities.map((quantity) => ({
      name: quantity.name,
      value: formatValue(quantity.value),
    })),
  }));
}

function buildSelectedEntity(store: IfcDataStore, expressId: number): SelectedIfcEntity | null {
  const entityRef = store.entityIndex.byId.get(expressId);
  if (!entityRef) {
    return null;
  }

  const core = extractEntityAttributesOnDemand(store, expressId);
  const attributes = extractAllEntityAttributes(store, expressId);

  return {
    expressId,
    type: entityRef.type,
    globalId: core.globalId || null,
    name: core.name || null,
    description: core.description || null,
    objectType: core.objectType || null,
    tag: core.tag || null,
    attributes: attributes.map((entry) => ({
      name: entry.name,
      value: formatValue(entry.value),
    })),
    propertySets: buildPropertyGroups(store, expressId),
    quantitySets: buildQuantityGroups(store, expressId),
  };
}

function toViewerCameraState(renderer: Renderer): ViewerCameraState {
  const camera = renderer.getCamera();
  const position = camera.getPosition();
  const target = camera.getTarget();
  const up = camera.getUp();
  const isOrthographic = camera.getProjectionMode() === "orthographic";

  return {
    position,
    target,
    up,
    fov: camera.getFOV(),
    isOrthographic,
    orthoScale: isOrthographic ? camera.getOrthoSize() * 2 : undefined,
  };
}

function toViewerBounds(renderer: Renderer): ViewerBounds | null {
  return renderer.getModelBounds();
}

function toRendererSectionPlane(sectionPlane: ViewerSectionPlane | null) {
  if (!sectionPlane) {
    return undefined;
  }

  return {
    axis: sectionPlane.axis,
    position: sectionPlane.position,
    enabled: sectionPlane.enabled,
    flipped: sectionPlane.flipped,
  };
}

function getMergedOverrides(
  diffOverrides: Map<number, [number, number, number, number]>,
  bcfOverrides: Map<number, [number, number, number, number]>,
) {
  const merged = new Map<number, [number, number, number, number]>();
  diffOverrides.forEach((value, key) => merged.set(key, value));
  bcfOverrides.forEach((value, key) => merged.set(key, value));
  return merged;
}

function collectIfcSpaceExpressIds(store: IfcDataStore | null): Set<number> {
  if (!store) {
    return new Set();
  }

  const hiddenIds = new Set<number>();
  store.entityIndex.byId.forEach((entityRef, expressId) => {
    if (entityRef.type === "IfcSpace") {
      hiddenIds.add(expressId);
    }
  });

  return hiddenIds;
}

function removeIfcSpacesFromGeometry(geometryResult: GeometryResult): GeometryResult {
  const filteredMeshes = geometryResult.meshes.filter((mesh) => mesh.ifcType !== "IfcSpace");
  if (filteredMeshes.length === geometryResult.meshes.length) {
    return geometryResult;
  }

  const totalTriangles = filteredMeshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0);
  const totalVertices = filteredMeshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0);

  return {
    ...geometryResult,
    meshes: filteredMeshes,
    totalTriangles,
    totalVertices,
  };
}

export function useViewer(theme: Theme) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const parserRef = useRef<IfcParser | null>(null);
  const geometryRef = useRef<GeometryProcessor | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const overlayRendererRef = useRef<{
    setMarkers: (markers: BCFMarker3D[]) => void;
    setActiveMarker: (topicGuid: string | null) => void;
    setVisible: (visible: boolean) => void;
    updatePositions: () => void;
    dispose: () => void;
    onMarkerClick: (callback: (topicGuid: string) => void) => () => void;
  } | null>(null);
  const overlayProjectionListenersRef = useRef(new Set<() => void>());
  const clearColorRef = useRef<[number, number, number, number]>(getClearColor(theme));
  const latestLoadRequestRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const wheelInteractionTimeoutRef = useRef<number | null>(null);
  const diffOverridesRef = useRef<Map<number, [number, number, number, number]>>(new Map());
  const baseEntityColorsRef = useRef<Map<number, [number, number, number, number]>>(new Map());
  const ghostedExpressIdsRef = useRef<Set<number>>(new Set());
  const permanentlyHiddenExpressIdsRef = useRef<Set<number>>(new Set());
  const interactionRef = useRef<{
    pointerId: number | null;
    mode: "orbit" | "pan" | null;
    lastX: number;
    lastY: number;
    moved: boolean;
  }>({
    pointerId: null,
    mode: null,
    lastX: 0,
    lastY: 0,
    moved: false,
  });

  const currentStore = useAppStore((state) => state.currentStore);
  const repo = useAppStore((state) => state.repo);
  const authToken = useAppStore((state) => state.authToken);
  const activePath = useAppStore((state) => state.activePath);
  const activeSha = useAppStore((state) => state.activeSha);
  const branches = useAppStore((state) => state.branches);
  const selectedBranch = useAppStore((state) => state.selectedBranch);
  const availableBcfFiles = useAppStore((state) => state.availableBcfFiles);
  const bcfSourceName = useAppStore((state) => state.bcfSourceName);
  const selectedTopicGuid = useAppStore((state) => state.selectedTopicGuid);
  const selectedExpressId = useAppStore((state) => state.selectedExpressId);
  const viewerIsolatedExpressIds = useAppStore((state) => state.viewerIsolatedExpressIds);
  const viewerColoredExpressIds = useAppStore((state) => state.viewerColoredExpressIds);
  const activeSectionPlane = useAppStore((state) => state.activeSectionPlane);
  const setViewerApi = useAppStore((state) => state.setViewerApi);
  const setSelectedTopicGuid = useAppStore((state) => state.setSelectedTopicGuid);
  const setSelectedViewpointGuid = useAppStore((state) => state.setSelectedViewpointGuid);
  const setViewerFlags = useAppStore((state) => state.setViewerFlags);
  const setLoadState = useAppStore((state) => state.setLoadState);
  const setCurrentStore = useAppStore((state) => state.setCurrentStore);
  const setSelectedEntity = useAppStore((state) => state.setSelectedEntity);
  const setSelectedExpressId = useAppStore((state) => state.setSelectedExpressId);
  const setViewerCamera = useAppStore((state) => state.setViewerCamera);
  const setViewerBounds = useAppStore((state) => state.setViewerBounds);
  const setViewerHiddenExpressIds = useAppStore((state) => state.setViewerHiddenExpressIds);
  const setViewerIsolatedExpressIds = useAppStore((state) => state.setViewerIsolatedExpressIds);
  const setViewerColoredExpressIds = useAppStore((state) => state.setViewerColoredExpressIds);
  const setActiveSectionPlane = useAppStore((state) => state.setActiveSectionPlane);
  const [timelineVersions, setTimelineVersions] = useState<GitCommit[]>([]);
  const [historyBcfProject, setHistoryBcfProject] = useState<BCFProject | null>(null);
  const [topicHistoryByGuid, setTopicHistoryByGuid] = useState<TopicHistoryMap>(new Map());

  const getEffectiveHiddenExpressIds = useCallback((state: ReturnType<typeof useAppStore.getState>) => {
    const hiddenIds = new Set(state.viewerHiddenExpressIds);
    permanentlyHiddenExpressIdsRef.current.forEach((expressId) => {
      hiddenIds.add(expressId);
    });
    return hiddenIds;
  }, []);

  const syncViewerStateFromRenderer = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer?.isReady()) {
      return;
    }

    setViewerCamera(toViewerCameraState(renderer));
    setViewerBounds(toViewerBounds(renderer));
  }, [setViewerBounds, setViewerCamera]);

  const notifyOverlayProjectionChanged = useCallback(() => {
    overlayProjectionListenersRef.current.forEach((callback) => callback());
  }, []);

  const renderScene = useCallback(
    (
      selection: number | null = useAppStore.getState().selectedExpressId,
      options?: { isInteracting?: boolean },
    ) => {
      const renderer = rendererRef.current;
      if (!renderer?.isReady()) {
        return;
      }

      const state = useAppStore.getState();
      const mergedOverrides = getMergedOverrides(diffOverridesRef.current, state.viewerColoredExpressIds);
      const scene = renderer.getScene();
      const pipeline = renderer.getPipeline();
      const device = renderer.getGPUDevice();

      if (pipeline && device) {
        if (mergedOverrides.size > 0) {
          scene.setColorOverrides(mergedOverrides, device, pipeline);
        } else {
          scene.clearColorOverrides();
        }
      }

      renderer.render({
        clearColor: clearColorRef.current,
        isInteracting: options?.isInteracting,
        selectedId: selection,
        hiddenIds: getEffectiveHiddenExpressIds(state),
        isolatedIds: state.viewerIsolatedExpressIds,
        sectionPlane: toRendererSectionPlane(state.activeSectionPlane),
      });
      notifyOverlayProjectionChanged();
    },
    [getEffectiveHiddenExpressIds, notifyOverlayProjectionChanged],
  );

  const selectedBcfFile = useMemo(
    () => availableBcfFiles.find((file) => file.path === bcfSourceName) ?? null,
    [availableBcfFiles, bcfSourceName],
  );

  const resizeRenderer = useCallback(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    const renderer = rendererRef.current;

    if (!canvas || !stage || !renderer?.isReady()) {
      return;
    }

    const width = Math.max(Math.floor(stage.clientWidth), 1);
    const height = Math.max(Math.floor(stage.clientHeight), 1);
    const largestDimension = Math.max(width, height);
    const scale =
      largestDimension > MAX_RENDER_DIMENSION
        ? MAX_RENDER_DIMENSION / largestDimension
        : 1;

    renderer.resize(
      Math.max(Math.floor(width * scale), 1),
      Math.max(Math.floor(height * scale), 1),
    );
    syncViewerStateFromRenderer();
    renderScene();
    notifyOverlayProjectionChanged();
  }, [notifyOverlayProjectionChanged, renderScene, syncViewerStateFromRenderer]);

  const applyCameraState = useCallback(
    (cameraState: ViewerCameraState) => {
      const renderer = rendererRef.current;
      if (!renderer) {
        return;
      }

      const camera = renderer.getCamera();
      camera.setProjectionMode(
        (cameraState.isOrthographic ? "orthographic" : "perspective") as ProjectionMode,
      );
      camera.setPosition(cameraState.position.x, cameraState.position.y, cameraState.position.z);
      camera.setTarget(cameraState.target.x, cameraState.target.y, cameraState.target.z);
      camera.setUp(cameraState.up.x, cameraState.up.y, cameraState.up.z);
      camera.setFOV(cameraState.fov);
      if (cameraState.isOrthographic && cameraState.orthoScale) {
        camera.setOrthoSize(cameraState.orthoScale / 2);
      }

      syncViewerStateFromRenderer();
      renderScene();
      notifyOverlayProjectionChanged();
    },
    [notifyOverlayProjectionChanged, renderScene, syncViewerStateFromRenderer],
  );

  const frameExpressId = useCallback(
    async (expressId: number) => {
      const renderer = rendererRef.current;
      if (!renderer) {
        return;
      }

      const bounds = renderer.getScene().getEntityBoundingBox(expressId);
      if (!bounds) {
        return;
      }

      await renderer.getCamera().frameBounds(bounds.min, bounds.max, 250);
      syncViewerStateFromRenderer();
      renderScene(expressId);
      notifyOverlayProjectionChanged();
    },
    [notifyOverlayProjectionChanged, renderScene, syncViewerStateFromRenderer],
  );

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    async function init() {
      const canvas = canvasRef.current;
      const stage = stageRef.current;
      if (!canvas || !stage) {
        return;
      }

      if (!("gpu" in navigator)) {
        setViewerFlags({
          webGpuSupported: false,
          viewerReady: false,
        });
        return;
      }

      try {
        const parser = new IfcParser();
        const geometry = new GeometryProcessor();
        const renderer = new Renderer(canvas);

        parserRef.current = parser;
        geometryRef.current = geometry;
        rendererRef.current = renderer;
        console.debug("[bcf-overlay] module loaded", {
          hasRenderer: typeof BCFOverlayRenderer === "function",
          hasComputeMarkerPositions: typeof computeMarkerPositions === "function",
        });

        await geometry.init();
        await renderer.init();

        if (cancelled) {
          return;
        }

        const viewerApi: BcfViewerBridge = {
          captureSnapshot: () => renderer.captureScreenshot(),
          getCameraState: () => toViewerCameraState(renderer),
          getBounds: () => toViewerBounds(renderer),
          applyCameraState,
          frameExpressId,
          requestRender: () => renderScene(),
        };

        const projection: BCFOverlayProjection = {
          projectToScreen: (worldPos: { x: number; y: number; z: number }) => {
            const projected = renderer
              .getCamera()
              .projectToScreen(worldPos, canvas.clientWidth, canvas.clientHeight);
            return projected ? { x: projected.x, y: projected.y } : null;
          },
          getEntityBounds: (expressId: number) => {
            const bounds = renderer.getScene().getEntityBoundingBox(expressId);
            return bounds ? { min: bounds.min, max: bounds.max } : null;
          },
          getCanvasSize: () => ({
            width: canvas.clientWidth,
            height: canvas.clientHeight,
          }),
          getCameraPosition: () => renderer.getCamera().getPosition(),
          onCameraChange: (callback: () => void) => {
            overlayProjectionListenersRef.current.add(callback);
            return () => {
              overlayProjectionListenersRef.current.delete(callback);
            };
          },
        };

        if (typeof BCFOverlayRenderer === "function") {
          overlayRendererRef.current = new BCFOverlayRenderer(
            stage,
            projection,
            {
              showConnectors: true,
              showTooltips: true,
            },
          );
          console.debug("[bcf-overlay] renderer created", {
            stageSize: {
              width: stage.clientWidth,
              height: stage.clientHeight,
            },
            canvasSize: {
              width: canvas.clientWidth,
              height: canvas.clientHeight,
            },
          });
          overlayRendererRef.current?.onMarkerClick((topicGuid: string) => {
            const topic = useAppStore.getState().bcfProject?.topics.get(topicGuid) ?? null;
            console.debug("[bcf-overlay] marker clicked", {
              topicGuid,
              title: topic?.title ?? null,
            });
            setSelectedTopicGuid(topicGuid);
            setSelectedViewpointGuid(topic?.viewpoints[0]?.guid ?? null);
          });
        } else {
          console.warn("BCFOverlayRenderer export is unavailable; skipping BCF marker overlay.");
        }

        setViewerApi(viewerApi);
        setViewerFlags({
          webGpuSupported: true,
          viewerReady: true,
        });

        resizeRenderer();
        resizeObserver = new ResizeObserver(() => {
          resizeRenderer();
        });
        resizeObserver.observe(stage);
      } catch (caughtError) {
        setViewerFlags({
          webGpuSupported: true,
          viewerReady: false,
        });
        setLoadState({
          loadError:
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to initialize the WebGPU viewer.",
        });
      }
    }

    void init();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (wheelInteractionTimeoutRef.current !== null) {
        window.clearTimeout(wheelInteractionTimeoutRef.current);
      }
      setViewerApi(null);
      overlayRendererRef.current?.dispose();
      overlayRendererRef.current = null;
      overlayProjectionListenersRef.current.clear();
      rendererRef.current?.destroy();
      geometryRef.current?.dispose();
      rendererRef.current = null;
      geometryRef.current = null;
      parserRef.current = null;
    };
  }, [
    applyCameraState,
    frameExpressId,
    renderScene,
    resizeRenderer,
    setLoadState,
    setSelectedTopicGuid,
    setSelectedViewpointGuid,
    setViewerApi,
    setViewerFlags,
  ]);

  useEffect(() => {
    renderScene();
  }, [
    activeSectionPlane,
    renderScene,
    selectedExpressId,
    viewerColoredExpressIds,
    viewerIsolatedExpressIds,
  ]);

  useEffect(() => {
    if (!repo || !activePath) {
      setTimelineVersions([]);
      return;
    }

    let cancelled = false;
    const resolvedRepo = repo;
    const resolvedActivePath = activePath;
    const prioritizedBranches =
      selectedBranch
        ? branches.filter((branch) => branch.name === selectedBranch)
        : branches.slice(0, 6);

    async function loadVersions() {
      try {
        const historyByBranch = await Promise.all(
          prioritizedBranches.map(async (branch) => [
            branch.name,
            await getFileCommitHistory(
              resolvedRepo,
              branch.name,
              resolvedActivePath,
              authToken,
              20,
            ),
          ] as const),
        );

        if (cancelled) {
          return;
        }

        const mergedHistory = mergeBranchCommits(Object.fromEntries(historyByBranch));
        setTimelineVersions(mergedHistory.slice().reverse());
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setTimelineVersions([]);
        }
      }
    }

    void loadVersions();

    return () => {
      cancelled = true;
    };
  }, [activePath, authToken, branches, repo, selectedBranch]);

  useEffect(() => {
    if (!repo || !selectedBcfFile) {
      setHistoryBcfProject(null);
      return;
    }

    let cancelled = false;
    const resolvedRepo = repo;
    const resolvedBcfPath = selectedBcfFile.path;
    const resolvedBcfRef = selectedBcfFile.sha;

    async function loadHistoryBcfProject() {
      try {
        const buffer = await fetchRepoFileBuffer(
          resolvedRepo,
          resolvedBcfRef,
          resolvedBcfPath,
          authToken,
        );
        const project = await importBcfProject(buffer);
        if (!cancelled) {
          setHistoryBcfProject(project);
        }
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setHistoryBcfProject(null);
        }
      }
    }

    void loadHistoryBcfProject();

    return () => {
      cancelled = true;
    };
  }, [authToken, repo, selectedBcfFile]);

  useEffect(() => {
    const topics = historyBcfProject ? Array.from(historyBcfProject.topics.values()) : [];
    if (!repo || !selectedBcfFile || topics.length === 0) {
      setTopicHistoryByGuid(new Map());
      return;
    }

    let cancelled = false;
    const resolvedRepo = repo;
    const resolvedBcfPath = selectedBcfFile.path;
    const resolvedBcfRef = selectedBranch ?? selectedBcfFile.branch;

    async function loadTopicHistory() {
      try {
        const historyByGuid = await buildTopicHistoryByGuid({
          authToken,
          bcfPath: resolvedBcfPath,
          bcfRef: resolvedBcfRef,
          repo: resolvedRepo,
          topics,
        });

        if (!cancelled) {
          setTopicHistoryByGuid(historyByGuid);
        }
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setTopicHistoryByGuid(new Map());
        }
      }
    }

    void loadTopicHistory();

    return () => {
      cancelled = true;
    };
  }, [authToken, historyBcfProject, repo, selectedBcfFile, selectedBranch]);

  useEffect(() => {
    clearColorRef.current = getClearColor(theme);
    renderScene();
  }, [renderScene, theme]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const overlayRenderer = overlayRendererRef.current;
    if (!overlayRenderer) {
      if (historyBcfProject) {
        console.debug("[bcf-overlay] skipped marker update because renderer is unavailable");
      }
      return;
    }

    if (!renderer || !currentStore || !historyBcfProject || typeof computeMarkerPositions !== "function") {
      console.debug("[bcf-overlay] clearing markers", {
        hasRenderer: Boolean(renderer),
        hasStore: Boolean(currentStore),
        hasProject: Boolean(historyBcfProject),
        hasOverlayModule: typeof computeMarkerPositions === "function",
      });
      overlayRenderer.setMarkers([]);
      overlayRenderer.setVisible(false);
      return;
    }

    const guidLookup = new Map<string, number>();
    currentStore.entityIndex.byId.forEach((_, expressId) => {
      const attributes = extractEntityAttributesOnDemand(currentStore, expressId);
      if (attributes.globalId) {
        guidLookup.set(attributes.globalId, expressId);
      }
    });

    const allTopics = Array.from(historyBcfProject.topics.values()) as BCFTopic[];
    const activeCommitIndex = activeSha
      ? timelineVersions.findIndex((commit) => commit.sha === activeSha)
      : -1;
    const topics =
      activeCommitIndex >= 0
        ? allTopics.filter((topic) => {
            const anchorSha = resolveTopicCommitSha(topic, timelineVersions, topicHistoryByGuid);
            if (!anchorSha) {
              return false;
            }

            const anchorIndex = timelineVersions.findIndex((commit) => commit.sha === anchorSha);
            return anchorIndex >= 0 && anchorIndex <= activeCommitIndex;
          }).map((topic) => getTopicStateAtCommit(topic, activeSha!, timelineVersions, topicHistoryByGuid))
        : allTopics;

    const unresolvedByTopic = topics.map((topic) => {
      const selectedGuids =
        topic.viewpoints[0]?.components?.selection
          ?.map((component) => component.ifcGuid)
          .filter((guid): guid is string => Boolean(guid)) ?? [];

      const unresolvedGuids = selectedGuids.filter((guid) => !guidLookup.has(guid));

      return {
        topicGuid: topic.guid,
        title: topic.title,
        selectedGuidCount: selectedGuids.length,
        unresolvedGuidCount: unresolvedGuids.length,
        unresolvedGuids: unresolvedGuids.slice(0, 5),
      };
    });
    const markers = computeMarkerPositions(
      topics,
      (ifcGuid: string) => {
        const expressId = guidLookup.get(ifcGuid);
        if (typeof expressId !== "number") {
          return null;
        }

        const bounds = renderer.getScene().getEntityBoundingBox(expressId);
        return bounds ? { min: bounds.min, max: bounds.max } : null;
      },
      {
        targetDistance: renderer.getCamera().getDistance(),
      },
    );

    console.debug("[bcf-overlay] marker computation", {
      topicCount: topics.length,
      guidLookupSize: guidLookup.size,
      markerCount: markers.length,
      selectedTopicGuid,
      unresolvedByTopic,
      markers: markers.map((marker) => ({
        topicGuid: marker.topicGuid,
        title: marker.title,
        positionSource: marker.positionSource,
        position: marker.position,
        connectorAnchor: marker.connectorAnchor ?? null,
      })),
    });

    overlayRenderer.setMarkers(markers);
    overlayRenderer.setActiveMarker(selectedTopicGuid);
    overlayRenderer.setVisible(markers.length > 0);
    overlayRenderer.updatePositions();
  }, [activeSha, currentStore, historyBcfProject, selectedTopicGuid, timelineVersions, topicHistoryByGuid]);

  useEffect(() => {
    overlayRendererRef.current?.setActiveMarker(selectedTopicGuid);
  }, [selectedTopicGuid]);

  const loadIfc = useCallback(
    async (
      buffer: ArrayBuffer,
      requestKey: string,
      options?: { restoreCamera?: ViewerCameraState | null },
    ) => {
      const parser = parserRef.current;
      const geometry = geometryRef.current;
      const renderer = rendererRef.current;

      if (!parser || !geometry || !renderer) {
        throw new Error("Viewer is not ready yet.");
      }

      latestLoadRequestRef.current = requestKey;
      setLoadState({
        loading: true,
        loadError: null,
        loadProgress: 0,
      });

      try {
        const uint8 = new Uint8Array(buffer);
        const store = await parser.parseColumnar(buffer, {
          onProgress: ({ percent }) => {
            if (latestLoadRequestRef.current === requestKey) {
              setLoadState({ loadProgress: percent });
            }
          },
        });

        const geometryResult = removeIfcSpacesFromGeometry(await geometry.process(uint8));
        if (latestLoadRequestRef.current !== requestKey) {
          return null;
        }

        renderer.getScene().clear();
        renderer.clearCaches();
        renderer.getCamera().reset();
        diffOverridesRef.current = new Map();
        baseEntityColorsRef.current = new Map();
        ghostedExpressIdsRef.current = new Set();
        permanentlyHiddenExpressIdsRef.current = collectIfcSpaceExpressIds(store);
        setViewerHiddenExpressIds(new Set());
        setViewerIsolatedExpressIds(null);
        setViewerColoredExpressIds(new Map());
        setActiveSectionPlane(null);
        resizeRenderer();
        renderer.loadGeometry(geometryResult);
        if (options?.restoreCamera) {
          const camera = renderer.getCamera();
          camera.setProjectionMode(
            (options.restoreCamera.isOrthographic ? "orthographic" : "perspective") as ProjectionMode,
          );
          camera.setPosition(
            options.restoreCamera.position.x,
            options.restoreCamera.position.y,
            options.restoreCamera.position.z,
          );
          camera.setTarget(
            options.restoreCamera.target.x,
            options.restoreCamera.target.y,
            options.restoreCamera.target.z,
          );
          camera.setUp(options.restoreCamera.up.x, options.restoreCamera.up.y, options.restoreCamera.up.z);
          camera.setFOV(options.restoreCamera.fov);
          if (options.restoreCamera.isOrthographic && options.restoreCamera.orthoScale) {
            camera.setOrthoSize(options.restoreCamera.orthoScale / 2);
          }
        } else {
          renderer.fitToView();
        }
        syncViewerStateFromRenderer();
        renderScene(null);

        setCurrentStore(store);
        setSelectedEntity(null);
        setLoadState({
          loading: false,
          loadProgress: 100,
          loadError: null,
          entityCount: store.entityCount,
        });

        return store;
      } catch (caughtError) {
        if (latestLoadRequestRef.current !== requestKey) {
          return null;
        }

        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "Failed to load the IFC model.";

        setLoadState({
          loading: false,
          loadError: `${message} If the current model is too heavy for the GPU context, try a hard refresh.`,
        });
        throw caughtError;
      }
    },
    [
      renderScene,
      resizeRenderer,
      setActiveSectionPlane,
      setCurrentStore,
      setLoadState,
      setSelectedEntity,
      setViewerColoredExpressIds,
      setViewerHiddenExpressIds,
      setViewerIsolatedExpressIds,
      syncViewerStateFromRenderer,
    ],
  );

  const applyDiff = useCallback(
    (diff: IfcDiffResult | null, ghostNonAffected: boolean) => {
      const renderer = rendererRef.current;
      const pipeline = renderer?.getPipeline();
      const device = renderer?.getGPUDevice();
      const scene = renderer?.getScene();

      if (!currentStore || !renderer || !pipeline || !device || !scene) {
        diffOverridesRef.current = new Map();
        renderScene();
        return;
      }

      if (baseEntityColorsRef.current.size === 0) {
        currentStore.entityIndex.byId.forEach((_, expressId) => {
          const meshData = scene.getMeshData(expressId);
          if (meshData) {
            baseEntityColorsRef.current.set(expressId, [...meshData.color] as [number, number, number, number]);
          }
        });
      }

      const syncGhostedColors = (affectedExpressIds: Set<number>) => {
        const updates = new Map<number, [number, number, number, number]>();
        const nextGhostedIds = new Set<number>();

        ghostedExpressIdsRef.current.forEach((expressId) => {
          if (ghostNonAffected && !affectedExpressIds.has(expressId)) {
            nextGhostedIds.add(expressId);
            return;
          }

          const originalColor = baseEntityColorsRef.current.get(expressId);
          if (originalColor) {
            updates.set(expressId, originalColor);
          }
        });

        if (ghostNonAffected) {
          baseEntityColorsRef.current.forEach((originalColor, expressId) => {
            if (affectedExpressIds.has(expressId)) {
              return;
            }

            nextGhostedIds.add(expressId);
            updates.set(expressId, [
              originalColor[0],
              originalColor[1],
              originalColor[2],
              Math.min(originalColor[3], DIFF_GHOST_ALPHA),
            ]);
          });
        }

        if (updates.size > 0) {
          scene.updateMeshColors(updates, device, pipeline);
        }

        ghostedExpressIdsRef.current = nextGhostedIds;
      };

      if (!diff) {
        diffOverridesRef.current = new Map();
        syncGhostedColors(new Set());
        renderScene();
        return;
      }

      const overrides = new Map<number, [number, number, number, number]>();
      const changedIds =
        diff.changed.size > 0 ? diff.changed : new Set(Object.keys(diff.changesById ?? {}));
      const affectedExpressIds = new Set<number>();

      mapGuidsToExpressIds(currentStore, diff.added).forEach((expressId) => {
        affectedExpressIds.add(expressId);
        overrides.set(expressId, DIFF_COLORS.added);
      });

      mapGuidsToExpressIds(currentStore, changedIds).forEach((expressId) => {
        affectedExpressIds.add(expressId);
        overrides.set(expressId, DIFF_COLORS.changed);
      });

      syncGhostedColors(affectedExpressIds);
      diffOverridesRef.current = overrides;
      renderScene();
    },
    [currentStore, renderScene],
  );

  const handleCanvasClick = useCallback(
    async (event: MouseEvent<HTMLCanvasElement>) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }

      const renderer = rendererRef.current;
      if (!renderer || !currentStore) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      const picked = await renderer.pick(x, y, {
        hiddenIds: getEffectiveHiddenExpressIds(useAppStore.getState()),
        isolatedIds: viewerIsolatedExpressIds,
      });
      if (!picked) {
        setSelectedExpressId(null);
        setSelectedEntity(null);
        renderScene(null);
        return;
      }

      const entity = buildSelectedEntity(currentStore, picked.expressId);
      if (!entity) {
        return;
      }

      setSelectedEntity(entity);
      setSelectedExpressId(entity.expressId);
      renderScene(entity.expressId);
    },
    [
      currentStore,
      renderScene,
      setSelectedEntity,
      setSelectedExpressId,
      getEffectiveHiddenExpressIds,
      viewerIsolatedExpressIds,
    ],
  );

  const finishInteraction = useCallback(() => {
    interactionRef.current.pointerId = null;
    interactionRef.current.mode = null;
    interactionRef.current.lastX = 0;
    interactionRef.current.lastY = 0;
    interactionRef.current.moved = false;
    syncViewerStateFromRenderer();
    renderScene();
  }, [renderScene, syncViewerStateFromRenderer]);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "touch") {
      return;
    }

    if (interactionRef.current.pointerId !== null) {
      return;
    }

    const mode =
      event.button === 1 || event.button === 2 || event.ctrlKey || event.metaKey ? "pan" : "orbit";

    interactionRef.current.pointerId = event.pointerId;
    interactionRef.current.mode = mode;
    interactionRef.current.lastX = event.clientX;
    interactionRef.current.lastY = event.clientY;
    interactionRef.current.moved = false;

    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, []);

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (event.pointerType === "touch") {
        return;
      }

      const renderer = rendererRef.current;
      const interaction = interactionRef.current;
      if (!renderer || interaction.pointerId !== event.pointerId || interaction.mode === null) {
        return;
      }

      const deltaX = event.clientX - interaction.lastX;
      const deltaY = event.clientY - interaction.lastY;
      if (deltaX === 0 && deltaY === 0) {
        return;
      }

      interaction.lastX = event.clientX;
      interaction.lastY = event.clientY;

      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        interaction.moved = true;
      }

      const camera = renderer.getCamera();
      if (interaction.mode === "orbit") {
        camera.orbit(deltaX, deltaY);
      } else {
        camera.pan(deltaX, deltaY);
      }

      renderScene(undefined, { isInteracting: true });
      event.preventDefault();
    },
    [renderScene],
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (event.pointerType === "touch") {
        return;
      }

      if (interactionRef.current.pointerId !== event.pointerId) {
        return;
      }

      suppressClickRef.current = interactionRef.current.moved;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      finishInteraction();
      event.preventDefault();
    },
    [finishInteraction],
  );

  const handlePointerCancel = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (event.pointerType === "touch") {
        return;
      }

      if (interactionRef.current.pointerId !== event.pointerId) {
        return;
      }

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      finishInteraction();
    },
    [finishInteraction],
  );

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLCanvasElement>) => {
      const renderer = rendererRef.current;
      if (!renderer) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      renderer.getCamera().zoom(event.deltaY, false, x, y, rect.width, rect.height);
      renderScene(undefined, { isInteracting: true });

      if (wheelInteractionTimeoutRef.current !== null) {
        window.clearTimeout(wheelInteractionTimeoutRef.current);
      }

      wheelInteractionTimeoutRef.current = window.setTimeout(() => {
        syncViewerStateFromRenderer();
        renderScene();
        notifyOverlayProjectionChanged();
        wheelInteractionTimeoutRef.current = null;
      }, 120);

      event.preventDefault();
    },
    [notifyOverlayProjectionChanged, renderScene, syncViewerStateFromRenderer],
  );

  const handleContextMenu = useCallback((event: MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
  }, []);

  const getSelectedGlobalId = useCallback(() => {
    const store = useAppStore.getState().currentStore;
    const activeExpressId = useAppStore.getState().selectedExpressId;
    if (!store || activeExpressId === null) {
      return null;
    }

    return getGuidForExpressId(store, activeExpressId);
  }, []);

  return useMemo(
    () => ({
      canvasHandlers: {
        onContextMenu: handleContextMenu,
        onPointerCancel: handlePointerCancel,
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: handlePointerUp,
        onWheel: handleWheel,
      },
      canvasRef,
      stageRef,
      loadIfc,
      applyDiff,
      handleCanvasClick,
      captureViewpointInput: async () => {
        const renderer = rendererRef.current;
        const store = useAppStore.getState().currentStore;
        if (!renderer || !store) {
          return null;
        }

        const snapshot = await renderer.captureScreenshot();
        const state = useAppStore.getState();
        const selectedGuid = getSelectedGlobalId();

        return {
          camera: toViewerCameraState(renderer),
          bounds: toViewerBounds(renderer) ?? undefined,
          sectionPlane: state.activeSectionPlane,
          selectedGuids: selectedGuid ? [selectedGuid] : [],
          hiddenGuids: mapSetToGuids(store, getEffectiveHiddenExpressIds(state)),
          visibleGuids: state.viewerIsolatedExpressIds ? mapSetToGuids(store, state.viewerIsolatedExpressIds) : [],
          coloredGuids: colorOverridesToGuids(store, state.viewerColoredExpressIds),
          snapshot,
        };
      },
      applyViewpointSelection: (params: {
        selectedExpressId: number | null;
        hiddenExpressIds: Set<number>;
        isolatedExpressIds: Set<number> | null;
        coloredExpressIds: Map<number, [number, number, number, number]>;
        sectionPlane: ViewerSectionPlane | null;
        camera: ViewerCameraState | null;
      }) => {
        setViewerHiddenExpressIds(params.hiddenExpressIds);
        setViewerIsolatedExpressIds(params.isolatedExpressIds);
        setViewerColoredExpressIds(params.coloredExpressIds);
        setActiveSectionPlane(params.sectionPlane);
        if (params.selectedExpressId !== null && currentStore) {
          const entity = buildSelectedEntity(currentStore, params.selectedExpressId);
          setSelectedEntity(entity);
          setSelectedExpressId(params.selectedExpressId);
        } else {
          setSelectedEntity(null);
          setSelectedExpressId(null);
        }
        if (params.camera) {
          applyCameraState(params.camera);
        } else {
          renderScene(params.selectedExpressId);
        }
      },
    }),
    [
      applyCameraState,
      applyDiff,
      currentStore,
      getSelectedGlobalId,
      getEffectiveHiddenExpressIds,
      handleCanvasClick,
      handleContextMenu,
      handlePointerCancel,
      handlePointerDown,
      handlePointerMove,
      handlePointerUp,
      handleWheel,
      loadIfc,
      renderScene,
      setActiveSectionPlane,
      setSelectedEntity,
      setSelectedExpressId,
      setViewerColoredExpressIds,
      setViewerHiddenExpressIds,
      setViewerIsolatedExpressIds,
    ],
  );
}

function mapSetToGuids(store: IfcDataStore, ids: Set<number>) {
  return Array.from(ids)
    .map((expressId) => getGuidForExpressId(store, expressId))
    .filter((guid): guid is string => Boolean(guid));
}
