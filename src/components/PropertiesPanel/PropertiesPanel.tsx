import { useVersionedQueryExplorer } from "../../hooks/useVersionedQueryExplorer";
import { useAppStore } from "../../store/useAppStore";
import type { QueryComponentRecord } from "../../types/ifc";

function ResultList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="results-group">
      <h4>{title}</h4>
      {items.length === 0 ? (
        <p className="results-group__empty">None</p>
      ) : (
        <ul className="results-group__list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DiffDetailList() {
  const diffResult = useAppStore((state) => state.diffResult);
  const detailItems = diffResult
    ? Object.values(diffResult.detailsById).sort((left, right) => {
        const statusOrder = { changed: 0, added: 1, deleted: 2 } as const;
        return (
          statusOrder[left.status] - statusOrder[right.status] ||
          left.type.localeCompare(right.type) ||
          left.globalId.localeCompare(right.globalId)
        );
      })
    : [];

  return (
    <section className="results-group">
      <h4>Component details</h4>
      {detailItems.length === 0 ? (
        <p className="results-group__empty">No detailed component metadata reported.</p>
      ) : (
        <ul className="results-group__changes">
          {detailItems.map((detail) => (
            <li key={detail.globalId}>
              <strong>{detail.globalId}</strong>
              <span>
                {detail.status} · {detail.type}
                {detail.previousType && detail.previousType !== detail.type
                  ? ` (was ${detail.previousType})`
                  : ""}
              </span>
              <code>
                {[detail.name, detail.objectType, detail.tag].filter(Boolean).join(" · ") ||
                  detail.description ||
                  "No descriptive fields"}
              </code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
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
    <section className="results-detail explorer-detail">
      <header className="results-detail__header">
        <h3>Query explorer</h3>
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
              ? "Loading backend results..."
              : `${queryResultCount} matching component${queryResultCount === 1 ? "" : "s"}`}
          </span>
          <span>
            {queryResultTruncated
              ? `Showing first ${queryResults.length} results`
              : queryResults.length > 0
                ? `Showing all ${queryResults.length}`
                : "Choose a filter to start exploring"}
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
          <h3>No components matched</h3>
          <p>Try a different type for this indexed backend version.</p>
        </div>
      ) : (
        <section className="results-group">
          <h4>Component matches</h4>
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
  );
}

export function PropertiesPanel() {
  useVersionedQueryExplorer();

  const diffHighlightEnabled = useAppStore((state) => state.diffHighlightEnabled);
  const diffResult = useAppStore((state) => state.diffResult);
  const setDiffHighlightEnabled = useAppStore((state) => state.setDiffHighlightEnabled);
  const added = diffResult ? Array.from(diffResult.added).sort() : [];
  const changed = diffResult ? Array.from(diffResult.changed).sort() : [];
  const deleted = diffResult ? Array.from(diffResult.deleted).sort() : [];
  const changeEntries = diffResult ? Object.entries(diffResult.changesById) : [];

  return (
    <aside className="panel panel--properties">
      <div className="panel__eyebrow">Results</div>

      <label className="results-toggle">
        <span>Diff coloring</span>
        <input
          type="checkbox"
          checked={diffHighlightEnabled}
          onChange={(event) => setDiffHighlightEnabled(event.target.checked)}
        />
      </label>

      <div className="diff-summary">
        <div className="diff-summary__item">
          <span>Added</span>
          <strong>{diffResult?.added.size ?? 0}</strong>
        </div>
        <div className="diff-summary__item">
          <span>Changed</span>
          <strong>{diffResult?.changed.size ?? 0}</strong>
        </div>
        <div className="diff-summary__item">
          <span>Deleted</span>
          <strong>{diffResult?.deleted.size ?? 0}</strong>
        </div>
      </div>

      {!diffResult ? (
        <div className="results-empty">
          <h3>No diff data yet</h3>
          <p>
            The current tracked model either has no previous revision in the selected GitHub repo or is
            not an IFC revision the viewer can load.
          </p>
        </div>
      ) : (
        <div className="results-detail">
          <header className="results-detail__header">
            <h3>Compared revisions</h3>
            <p>
              Base <strong>{diffResult.baseSha.slice(0, 7)}</strong> to current{" "}
              <strong>{diffResult.compareSha.slice(0, 7)}</strong>
            </p>
          </header>

          <section className="results-group">
            <h4>Changed fields</h4>
            {changeEntries.length === 0 ? (
              <p className="results-group__empty">No changed fields reported.</p>
            ) : (
              <ul className="results-group__changes">
                {changeEntries.map(([guid, change]) => (
                  <li key={guid}>
                    <strong>{guid}</strong>
                    <span>{change.type}</span>
                    <code>{change.fields.join(", ") || "No field list"}</code>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <DiffDetailList />
          <ResultList title="Added IDs" items={added} />
          <ResultList title="Changed IDs" items={changed} />
          <ResultList title="Deleted IDs" items={deleted} />
        </div>
      )}

      <QueryExplorer />
    </aside>
  );
}
