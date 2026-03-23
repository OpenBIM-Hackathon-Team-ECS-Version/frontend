import { useEffect, useMemo, useState } from "react";

import type { IfcDiffDetail, QueryComponentRecord } from "../../types/ifc";
import { mapGuidsToExpressIds } from "../../lib/ifcDiff";
import { useVersionedQueryExplorer } from "../../hooks/useVersionedQueryExplorer";
import { useAppStore } from "../../store/useAppStore";

type ImpactedChange = {
  globalId: string;
  status: "added" | "changed" | "deleted";
  title: string;
  subtitle: string;
  type: string;
  detail: IfcDiffDetail | null;
  changedFields: string[];
};

const STATUS_ORDER: Record<ImpactedChange["status"], number> = {
  changed: 0,
  added: 1,
  deleted: 2,
};

const STATUS_LABEL: Record<ImpactedChange["status"], string> = {
  added: "Added",
  changed: "Changed",
  deleted: "Deleted",
};

function isNumericMetadata(value: string | null | undefined) {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 && /^\d+$/.test(trimmed);
}

function stripTrailingNumericSuffix(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\s*[:\-]+\s*\d+\s*$/, "").trim() || trimmed;
}

function summarizeComponent(component: QueryComponentRecord) {
  const summaryParts = [
    component.entityType,
    component.entityGuid,
    typeof component.objectType === "string" ? component.objectType : null,
    typeof component.tag === "string" ? component.tag : null,
  ].filter(Boolean);

  if (summaryParts.length > 0) {
    return summaryParts.join(" · ");
  }

  const preferredKeys = [
    "representationIdentifier",
    "representationFormat",
    "name",
    "description",
  ] as const;
  const extraParts = preferredKeys
    .map((key) => {
      const value = component[key];
      return typeof value === "string" && value.trim().length > 0 ? `${key}: ${value}` : null;
    })
    .filter(Boolean);

  return extraParts.join(" · ") || "No compact summary available";
}

function getReadableTitle(detail: IfcDiffDetail | null, globalId: string) {
  return (
    stripTrailingNumericSuffix(detail?.name) ||
    detail?.objectType?.trim() ||
    (isNumericMetadata(detail?.tag) ? null : detail?.tag?.trim()) ||
    detail?.type ||
    globalId
  );
}

function getReadableSubtitle(detail: IfcDiffDetail | null, changedFields: string[]) {
  const parts = [
    detail?.type ?? null,
    detail?.previousType && detail.previousType !== detail.type ? `was ${detail.previousType}` : null,
    detail?.objectType ?? null,
    isNumericMetadata(detail?.tag) ? null : detail?.tag ?? null,
    changedFields.length > 0 ? `${changedFields.length} field${changedFields.length === 1 ? "" : "s"} changed` : null,
  ].filter(Boolean);

  return parts.join(" · ") || "No descriptive metadata";
}

function buildImpactedChanges(diffResult: ReturnType<typeof useAppStore.getState>["diffResult"]) {
  if (!diffResult) {
    return [];
  }

  const allIds = new Set<string>([
    ...diffResult.added,
    ...diffResult.changed,
    ...diffResult.deleted,
    ...Object.keys(diffResult.detailsById),
    ...Object.keys(diffResult.changesById),
  ]);

  return Array.from(allIds)
    .map((globalId) => {
      const detail = diffResult.detailsById[globalId] ?? null;
      const changeMeta = diffResult.changesById[globalId];
      const status =
        detail?.status ??
        (diffResult.changed.has(globalId)
          ? "changed"
          : diffResult.added.has(globalId)
            ? "added"
            : "deleted");
      const changedFields = detail?.changedFields ?? changeMeta?.fields ?? [];

      return {
        globalId,
        status,
        title: getReadableTitle(detail, globalId),
        subtitle: getReadableSubtitle(detail, changedFields),
        type: detail?.type ?? changeMeta?.type ?? "Unknown type",
        detail,
        changedFields,
      } satisfies ImpactedChange;
    })
    .sort((left, right) => {
      return (
        STATUS_ORDER[left.status] - STATUS_ORDER[right.status] ||
        left.title.localeCompare(right.title) ||
        left.globalId.localeCompare(right.globalId)
      );
    });
}

function ChangeSummary({
  diffResult,
  impactedCount,
}: {
  diffResult: NonNullable<ReturnType<typeof useAppStore.getState>["diffResult"]>;
  impactedCount: number;
}) {
  return (
    <section className="results-hero">
      <div className="results-hero__content">
        <h3>{impactedCount} impacted element{impactedCount === 1 ? "" : "s"}</h3>
        <p>
          Base <strong>{diffResult.baseSha.slice(0, 7)}</strong> to current{" "}
          <strong>{diffResult.compareSha.slice(0, 7)}</strong>
        </p>
      </div>
      <div className="diff-summary">
        <div className="diff-summary__item diff-summary__item--added">
          <span>Added</span>
          <strong>{diffResult.added.size}</strong>
        </div>
        <div className="diff-summary__item diff-summary__item--changed">
          <span>Changed</span>
          <strong>{diffResult.changed.size}</strong>
        </div>
        <div className="diff-summary__item diff-summary__item--deleted">
          <span>Deleted</span>
          <strong>{diffResult.deleted.size}</strong>
        </div>
      </div>
    </section>
  );
}

function ImpactedComponentsList({
  items,
  activeId,
  onSelect,
}: {
  items: ImpactedChange[];
  activeId: string | null;
  onSelect: (globalId: string) => void;
}) {
  return (
    <section className="results-section">
      <header className="results-section__header">
        <h3>Impacted elements</h3>
        <p>Prioritized for review.</p>
      </header>

      <div className="impact-list">
        {items.map((item) => (
          <button
            key={item.globalId}
            type="button"
            className={`impact-card impact-card--${item.status} ${item.globalId === activeId ? "is-active" : ""}`}
            onClick={() => onSelect(item.globalId)}
          >
            <div className="impact-card__topline">
              <span className={`impact-badge impact-badge--${item.status}`}>{STATUS_LABEL[item.status]}</span>
              <span className="impact-card__type">{item.type}</span>
            </div>
            <strong>{item.title}</strong>
            <span>{item.subtitle}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SelectedChangeDetails({ item }: { item: ImpactedChange | null }) {
  if (!item) {
    return (
      <section className="results-empty">
        <h3>No impacted element selected</h3>
        <p>Pick an item from the list to inspect what changed and where to look in the model.</p>
      </section>
    );
  }

  const descriptor = [item.detail?.name, item.detail?.objectType, item.detail?.tag].filter(Boolean).join(" · ");

  return (
    <section className="results-section">
      <header className="results-section__header">
        <h3>Selected element</h3>
        <p>{STATUS_LABEL[item.status]} in this revision</p>
      </header>

      <div className="results-detail-card">
        <div className="results-detail-card__headline">
          <div>
            <span className={`impact-badge impact-badge--${item.status}`}>{STATUS_LABEL[item.status]}</span>
            <h4>{item.title}</h4>
          </div>
          <span className="results-detail-card__type">{item.type}</span>
        </div>

        <div className="results-meta-grid">
          <div className="results-meta-block">
            <strong>Changed fields</strong>
            <span>{item.changedFields.length > 0 ? item.changedFields.join(", ") : "No changed fields reported"}</span>
          </div>
          <div className="results-meta-block">
            <strong>Description</strong>
            <span>{descriptor || item.detail?.description || "No descriptive fields"}</span>
          </div>
          <div className="results-meta-block">
            <strong>Type context</strong>
            <span>
              {item.detail?.previousType && item.detail.previousType !== item.detail.type
                ? `${item.detail.previousType} -> ${item.detail.type}`
                : item.type}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function QueryExplorer() {
  const queryVersions = useAppStore((state) => state.queryVersions);
  const selectedQueryVersion = useAppStore((state) => state.selectedQueryVersion);
  const queryTypes = useAppStore((state) => state.queryTypes);
  const queryFilters = useAppStore((state) => state.queryFilters);
  const queryResults = useAppStore((state) => state.queryResults);
  const queryResultCount = useAppStore((state) => state.queryResultCount);
  const queryResultTruncated = useAppStore((state) => state.queryResultTruncated);
  const queryLoading = useAppStore((state) => state.queryLoading);
  const queryError = useAppStore((state) => state.queryError);
  const setQueryExplorerState = useAppStore((state) => state.setQueryExplorerState);
  const setQueryFilters = useAppStore((state) => state.setQueryFilters);
  const selectedVersionMeta =
    queryVersions.find((version) => version.versionId === selectedQueryVersion) ?? null;
  const hasActiveFilters = Boolean(queryFilters.type);

  return (
    <details className="results-advanced">
      <summary>Advanced query explorer</summary>

      <section className="results-detail explorer-detail">
        <header className="results-section__header">
          <h3>Backend index</h3>
          <p>Inspect indexed backend snapshots by version and type, separate from raw GitHub IFC history.</p>
        </header>

        <div className="results-group explorer-controls">
          <label className="field">
            <span className="field__label">Indexed version</span>
            <select
              value={selectedQueryVersion ?? ""}
              onChange={(event) =>
                setQueryExplorerState({
                  selectedQueryVersion: event.target.value || null,
                  queryResults: [],
                  queryResultCount: 0,
                  queryResultTruncated: false,
                })
              }
              disabled={queryVersions.length === 0}
            >
              <option value="" disabled>
                {queryVersions.length === 0 ? "No backend versions" : "Select indexed version"}
              </option>
              {queryVersions.map((version) => (
                <option key={version.versionId} value={version.versionId}>
                  {version.shortId} · {version.message.split("\n")[0]}
                </option>
              ))}
            </select>
          </label>

          <div className="explorer-version-meta">
            {selectedVersionMeta ? (
              <>
                <strong>{selectedVersionMeta.shortId}</strong>
                <span>{selectedVersionMeta.author}</span>
                <span>{new Date(selectedVersionMeta.timestamp).toLocaleString()}</span>
              </>
            ) : (
              <span>No indexed version selected yet.</span>
            )}
          </div>

          <label className="field">
            <span className="field__label">Type</span>
            <select
              value={queryFilters.type ?? ""}
              onChange={(event) => setQueryFilters({ type: event.target.value || null })}
              disabled={!selectedQueryVersion || queryTypes.length === 0}
            >
              <option value="">All types</option>
              {queryTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>

          <div className="explorer-meta">
            <span>
              {queryLoading
                ? "Loading indexed matches..."
                : `${queryResultCount} indexed match${queryResultCount === 1 ? "" : "es"}`}
            </span>
            <span>
              {queryResultTruncated
                ? `Showing first ${queryResults.length} results`
                : queryResults.length > 0
                  ? `Showing all ${queryResults.length}`
                  : "Choose a type to load indexed matches"}
            </span>
          </div>
        </div>

        {queryError ? (
          <div className="results-empty">
            <h3>Backend explorer unavailable</h3>
            <p>{queryError}</p>
          </div>
        ) : !selectedQueryVersion ? (
          <div className="results-empty">
            <h3>No indexed versions</h3>
            <p>The backend did not return any versioned snapshots to explore.</p>
          </div>
        ) : !hasActiveFilters ? (
          <div className="results-empty">
            <h3>Pick a type filter</h3>
            <p>Select a type to query the backend index for this version.</p>
          </div>
        ) : queryResults.length === 0 && !queryLoading ? (
          <div className="results-empty">
            <h3>No indexed matches</h3>
            <p>Try a different type for this indexed backend version.</p>
          </div>
        ) : (
          <section className="results-group">
            <h4>Indexed matches</h4>
            <ul className="results-group__changes explorer-results">
              {queryResults.map((component) => (
                <li key={component.componentGuid}>
                  <strong>{component.componentGuid}</strong>
                  <span>
                    {component._model ?? "unknown model"} · {component.componentType ?? "Unknown type"}
                  </span>
                  <code>{summarizeComponent(component)}</code>
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>
    </details>
  );
}

export function PropertiesPanel() {
  useVersionedQueryExplorer();

  const diffResult = useAppStore((state) => state.diffResult);
  const selectedEntity = useAppStore((state) => state.selectedEntity);
  const currentStore = useAppStore((state) => state.currentStore);
  const viewerApi = useAppStore((state) => state.viewerApi);
  const setSelectedExpressId = useAppStore((state) => state.setSelectedExpressId);
  const impactedChanges = useMemo(() => buildImpactedChanges(diffResult), [diffResult]);
  const prioritizedChanges = useMemo(() => {
    const selectedGlobalId = selectedEntity?.globalId ?? null;
    if (!selectedGlobalId) {
      return impactedChanges;
    }

    return impactedChanges.slice().sort((left, right) => {
      const leftSelected = left.globalId === selectedGlobalId ? -1 : 0;
      const rightSelected = right.globalId === selectedGlobalId ? -1 : 0;
      return leftSelected - rightSelected;
    });
  }, [impactedChanges, selectedEntity?.globalId]);
  const [activeChangeId, setActiveChangeId] = useState<string | null>(null);
  const activeChange =
    prioritizedChanges.find((item) => item.globalId === activeChangeId) ??
    prioritizedChanges[0] ??
    null;

  useEffect(() => {
    const selectedGlobalId = selectedEntity?.globalId ?? null;
    if (selectedGlobalId && prioritizedChanges.some((item) => item.globalId === selectedGlobalId)) {
      setActiveChangeId(selectedGlobalId);
      return;
    }

    if (!activeChangeId || !prioritizedChanges.some((item) => item.globalId === activeChangeId)) {
      setActiveChangeId(prioritizedChanges[0]?.globalId ?? null);
    }
  }, [activeChangeId, prioritizedChanges, selectedEntity?.globalId]);

  async function handleSelectChange(globalId: string) {
    setActiveChangeId(globalId);

    if (!currentStore || !viewerApi) {
      return;
    }

    const [expressId] = mapGuidsToExpressIds(currentStore, [globalId]);
    if (typeof expressId !== "number") {
      return;
    }

    setSelectedExpressId(expressId);
    await viewerApi.frameExpressId(expressId);
    viewerApi.requestRender();
  }

  return (
    <aside className="panel panel--properties">
      <h2 className="panel__title">Component Diffs</h2>

      {!diffResult ? (
        <div className="results-stack">
          <div className="results-empty">
            <h3>No diff data yet</h3>
            <p>
              The current tracked model either has no previous revision in the selected GitHub repo or is
              not an IFC revision the viewer can load.
            </p>
          </div>
          <QueryExplorer />
        </div>
      ) : (
        <div className="results-stack">
          <ChangeSummary diffResult={diffResult} impactedCount={impactedChanges.length} />

          <ImpactedComponentsList
            items={prioritizedChanges}
            activeId={activeChange?.globalId ?? null}
            onSelect={(globalId) => void handleSelectChange(globalId)}
          />

          <SelectedChangeDetails item={activeChange} />

          <QueryExplorer />
        </div>
      )}
    </aside>
  );
}
