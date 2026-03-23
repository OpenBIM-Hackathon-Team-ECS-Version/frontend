import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import { GeometryProcessor } from "@ifc-lite/geometry";
import { Renderer } from "@ifc-lite/renderer";

import { mapGuidsToExpressIds } from "../../lib/ifcDiff";
import { useAppStore } from "../../store/useAppStore";
import type { IfcDiffResult, IfcPropertyGroup, SelectedIfcEntity } from "../../types/ifc";

const CLEAR_COLOR: [number, number, number, number] = [0.045, 0.052, 0.08, 1];
const MAX_RENDER_DIMENSION = 4096;
const DIFF_COLORS = {
  added: [0.07, 0.77, 0.45, 1] as [number, number, number, number],
  changed: [1, 0.68, 0.16, 1] as [number, number, number, number],
};

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

export function useViewer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const parserRef = useRef<IfcParser | null>(null);
  const geometryRef = useRef<GeometryProcessor | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const latestLoadRequestRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const wheelInteractionTimeoutRef = useRef<number | null>(null);
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
  const selectedExpressId = useAppStore((state) => state.selectedExpressId);
  const setViewerFlags = useAppStore((state) => state.setViewerFlags);
  const setLoadState = useAppStore((state) => state.setLoadState);
  const setCurrentStore = useAppStore((state) => state.setCurrentStore);
  const setSelectedEntity = useAppStore((state) => state.setSelectedEntity);
  const setSelectedExpressId = useAppStore((state) => state.setSelectedExpressId);

  const renderScene = useCallback(
    (
      selection: number | null = useAppStore.getState().selectedExpressId,
      options?: { isInteracting?: boolean },
    ) => {
      const renderer = rendererRef.current;
      if (!renderer?.isReady()) {
        return;
      }

      renderer.render({
        clearColor: CLEAR_COLOR,
        isInteracting: options?.isInteracting,
        selectedId: selection,
      });
    },
    [],
  );

  const resizeRenderer = useCallback(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;

    if (!canvas || !renderer?.isReady()) {
      return;
    }

    const width = Math.max(Math.floor(canvas.clientWidth), 1);
    const height = Math.max(Math.floor(canvas.clientHeight), 1);
    const largestDimension = Math.max(width, height);
    const scale =
      largestDimension > MAX_RENDER_DIMENSION
        ? MAX_RENDER_DIMENSION / largestDimension
        : 1;

    renderer.resize(
      Math.max(Math.floor(width * scale), 1),
      Math.max(Math.floor(height * scale), 1),
    );
    renderScene();
  }, [renderScene]);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    async function init() {
      const canvas = canvasRef.current;
      if (!canvas) {
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

        await geometry.init();
        await renderer.init();

        if (cancelled) {
          return;
        }

        setViewerFlags({
          webGpuSupported: true,
          viewerReady: true,
        });

        resizeRenderer();
        resizeObserver = new ResizeObserver(() => {
          resizeRenderer();
        });
        resizeObserver.observe(canvas);
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
      rendererRef.current?.destroy();
      geometryRef.current?.dispose();
      rendererRef.current = null;
      geometryRef.current = null;
      parserRef.current = null;
    };
  }, [renderScene, resizeRenderer, setLoadState, setViewerFlags]);

  useEffect(() => {
    renderScene();
  }, [renderScene, selectedExpressId]);

  const loadIfc = useCallback(
    async (buffer: ArrayBuffer, requestKey: string) => {
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

        const geometryResult = await geometry.process(uint8);
        if (latestLoadRequestRef.current !== requestKey) {
          return null;
        }

        renderer.getScene().clear();
        renderer.clearCaches();
        renderer.getCamera().reset();
        resizeRenderer();
        renderer.loadGeometry(geometryResult);
        renderer.fitToView();
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
          loadError: `${message} If the sample model is too heavy for the current GPU context, try a hard refresh.`,
        });
        throw caughtError;
      }
    },
    [renderScene, resizeRenderer, setCurrentStore, setLoadState, setSelectedEntity],
  );

  const applyDiff = useCallback(
    (diff: IfcDiffResult | null) => {
      const renderer = rendererRef.current;
      const scene = renderer?.getScene();
      const pipeline = renderer?.getPipeline();
      const device = renderer?.getGPUDevice();

      if (!renderer || !scene || !currentStore || !pipeline || !device) {
        return;
      }

      if (!diff) {
        scene.clearColorOverrides();
        renderScene();
        return;
      }

      const overrides = new Map<number, [number, number, number, number]>();
      const changedIds =
        diff.changed.size > 0 ? diff.changed : new Set(Object.keys(diff.changesById ?? {}));

      mapGuidsToExpressIds(currentStore, diff.added).forEach((expressId) => {
        overrides.set(expressId, DIFF_COLORS.added);
      });

      mapGuidsToExpressIds(currentStore, changedIds).forEach((expressId) => {
        overrides.set(expressId, DIFF_COLORS.changed);
      });

      if (overrides.size > 0) {
        scene.setColorOverrides(overrides, device, pipeline);
      } else {
        scene.clearColorOverrides();
      }

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

      const picked = await renderer.pick(x, y);
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
    [currentStore, renderScene, setSelectedEntity, setSelectedExpressId],
  );

  const finishInteraction = useCallback(() => {
    interactionRef.current.pointerId = null;
    interactionRef.current.mode = null;
    interactionRef.current.lastX = 0;
    interactionRef.current.lastY = 0;
    interactionRef.current.moved = false;
    renderScene();
  }, [renderScene]);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
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
        renderScene();
        wheelInteractionTimeoutRef.current = null;
      }, 120);

      event.preventDefault();
    },
    [renderScene],
  );

  const handleContextMenu = useCallback((event: MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
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
      loadIfc,
      applyDiff,
      handleCanvasClick,
    }),
    [
      applyDiff,
      handleCanvasClick,
      handleContextMenu,
      handlePointerCancel,
      handlePointerDown,
      handlePointerMove,
      handlePointerUp,
      handleWheel,
      loadIfc,
    ],
  );
}
