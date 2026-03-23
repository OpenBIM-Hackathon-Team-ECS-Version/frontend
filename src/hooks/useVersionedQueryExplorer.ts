import { useEffect } from "react";

import {
  getComponents,
  getComponentGuids,
  getEntityTypes,
  getVersions,
} from "../lib/api";
import { useAppStore } from "../store/useAppStore";
import type { QueryComponentRecord } from "../types/ifc";

const MAX_COMPONENT_RESULTS = 60;

function flattenGuidMap(guidMap: Record<string, string[]>) {
  return Array.from(new Set(Object.values(guidMap).flat())).sort((left, right) =>
    left.localeCompare(right),
  );
}

function flattenComponentMap(componentMap: Record<string, QueryComponentRecord[]>) {
  return Object.entries(componentMap)
    .flatMap(([modelName, components]) =>
      components.map((component) => ({
        ...component,
        _model:
          typeof component._model === "string" && component._model.trim().length > 0
            ? component._model
            : modelName,
      })),
    )
    .sort((left, right) => {
      const modelCompare = String(left._model ?? "").localeCompare(String(right._model ?? ""));
      if (modelCompare !== 0) {
        return modelCompare;
      }

      const typeCompare = String(left.componentType ?? "").localeCompare(
        String(right.componentType ?? ""),
      );
      if (typeCompare !== 0) {
        return typeCompare;
      }

      return String(left.componentGuid ?? "").localeCompare(String(right.componentGuid ?? ""));
    });
}

export function useVersionedQueryExplorer() {
  const queryVersions = useAppStore((state) => state.queryVersions);
  const selectedQueryVersion = useAppStore((state) => state.selectedQueryVersion);
  const queryFilters = useAppStore((state) => state.queryFilters);
  const setQueryExplorerState = useAppStore((state) => state.setQueryExplorerState);
  const setQueryFilters = useAppStore((state) => state.setQueryFilters);

  useEffect(() => {
    if (queryVersions.length > 0) {
      return;
    }

    let cancelled = false;

    async function loadVersions() {
      setQueryExplorerState({
        queryLoading: true,
        queryError: null,
      });

      try {
        const data = await getVersions();
        if (cancelled) {
          return;
        }

        const preferredVersion =
          (selectedQueryVersion &&
          data.versions.some((version) => version.versionId === selectedQueryVersion)
            ? selectedQueryVersion
            : null) ??
          data.latest ??
          data.versions[0]?.versionId ??
          null;

        setQueryExplorerState({
          queryVersions: data.versions,
          selectedQueryVersion: preferredVersion,
          queryLoading: false,
          queryError: null,
        });
      } catch (caughtError) {
        if (cancelled) {
          return;
        }

        setQueryExplorerState({
          queryVersions: [],
          selectedQueryVersion: null,
          queryLoading: false,
          queryError:
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to load backend versions.",
        });
      }
    }

    void loadVersions();

    return () => {
      cancelled = true;
    };
  }, [queryVersions.length, selectedQueryVersion, setQueryExplorerState]);

  useEffect(() => {
    if (!selectedQueryVersion) {
      setQueryExplorerState({
        queryTypes: [],
      });
      return;
    }

    let cancelled = false;

    async function loadTypeFilters() {
      setQueryExplorerState({
        queryLoading: true,
        queryError: null,
      });

      try {
        const entityTypes = await getEntityTypes(undefined, selectedQueryVersion);
        if (cancelled) {
          return;
        }

        const nextType = queryFilters.type && entityTypes.includes(queryFilters.type)
          ? queryFilters.type
          : null;

        setQueryExplorerState({
          queryTypes: entityTypes,
          queryLoading: false,
          queryError: null,
        });
        if (nextType !== queryFilters.type) {
          setQueryFilters({
            type: nextType,
          });
        }
      } catch (caughtError) {
        if (cancelled) {
          return;
        }

        setQueryExplorerState({
          queryTypes: [],
          queryLoading: false,
          queryError:
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to load backend type filters.",
        });
      }
    }

    void loadTypeFilters();

    return () => {
      cancelled = true;
    };
  }, [
    queryFilters.type,
    selectedQueryVersion,
    setQueryExplorerState,
    setQueryFilters,
  ]);

  useEffect(() => {
    if (!selectedQueryVersion) {
      setQueryExplorerState({
        queryResults: [],
        queryResultCount: 0,
        queryResultTruncated: false,
        queryError: null,
      });
      return;
    }

    const hasActiveFilters = Boolean(queryFilters.type);
    if (!hasActiveFilters) {
      setQueryExplorerState({
        queryResults: [],
        queryResultCount: 0,
        queryResultTruncated: false,
        queryError: null,
      });
      return;
    }

    let cancelled = false;

    async function loadComponents() {
      setQueryExplorerState({
        queryLoading: true,
        queryError: null,
      });

      try {
        const guidMap = await getComponentGuids({
          entityTypes: queryFilters.type ? [queryFilters.type] : undefined,
          version: selectedQueryVersion,
        });
        if (cancelled) {
          return;
        }

        const allGuids = flattenGuidMap(guidMap);
        if (allGuids.length === 0) {
          setQueryExplorerState({
            queryResults: [],
            queryResultCount: 0,
            queryResultTruncated: false,
            queryLoading: false,
            queryError: null,
          });
          return;
        }

        const cappedGuids = allGuids.slice(0, MAX_COMPONENT_RESULTS);
        const componentsByModel = await getComponents({
          componentGuids: cappedGuids,
          version: selectedQueryVersion,
        });
        if (cancelled) {
          return;
        }

        setQueryExplorerState({
          queryResults: flattenComponentMap(componentsByModel),
          queryResultCount: allGuids.length,
          queryResultTruncated: allGuids.length > cappedGuids.length,
          queryLoading: false,
          queryError: null,
        });
      } catch (caughtError) {
        if (cancelled) {
          return;
        }

        setQueryExplorerState({
          queryResults: [],
          queryResultCount: 0,
          queryResultTruncated: false,
          queryLoading: false,
          queryError:
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to load backend component results.",
        });
      }
    }

    void loadComponents();

    return () => {
      cancelled = true;
    };
  }, [
    queryFilters.type,
    selectedQueryVersion,
    setQueryExplorerState,
  ]);
}
