import { useAppStore } from "../../store/useAppStore";

function PropertyGroup({
  title,
  entries,
}: {
  title: string;
  entries: Array<{ name: string; value: string }>;
}) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <section className="properties-group">
      <h4>{title}</h4>
      <dl>
        {entries.map((entry) => (
          <div key={`${title}-${entry.name}`} className="properties-group__row">
            <dt>{entry.name}</dt>
            <dd>{entry.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function PropertiesPanel() {
  const selectedEntity = useAppStore((state) => state.selectedEntity);
  const diffResult = useAppStore((state) => state.diffResult);

  return (
    <aside className="panel panel--properties">
      <div className="panel__eyebrow">Properties</div>

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
          <span>Removed</span>
          <strong>{diffResult?.removed.size ?? 0}</strong>
        </div>
      </div>

      {!selectedEntity ? (
        <div className="properties-empty">
          <h3>No entity selected</h3>
          <p>Click geometry in the viewer to inspect IFC attributes, property sets, and quantities.</p>
        </div>
      ) : (
        <div className="properties-detail">
          <header className="properties-detail__header">
            <div className="properties-detail__type">{selectedEntity.type}</div>
            <h3>{selectedEntity.name ?? `#${selectedEntity.expressId}`}</h3>
            <p>{selectedEntity.globalId ?? "No GlobalId available"}</p>
          </header>

          <PropertyGroup
            title="Entity"
            entries={[
              { name: "Express ID", value: String(selectedEntity.expressId) },
              { name: "Description", value: selectedEntity.description ?? "—" },
              { name: "Object type", value: selectedEntity.objectType ?? "—" },
              { name: "Tag", value: selectedEntity.tag ?? "—" },
            ]}
          />

          <PropertyGroup title="Named attributes" entries={selectedEntity.attributes} />

          {selectedEntity.propertySets.map((group) => (
            <PropertyGroup key={group.name} title={group.name} entries={group.entries} />
          ))}

          {selectedEntity.quantitySets.map((group) => (
            <PropertyGroup key={group.name} title={group.name} entries={group.entries} />
          ))}
        </div>
      )}
    </aside>
  );
}
