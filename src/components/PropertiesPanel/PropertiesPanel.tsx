import { useAppStore } from "../../store/useAppStore";

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

export function PropertiesPanel() {
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
    </aside>
  );
}
