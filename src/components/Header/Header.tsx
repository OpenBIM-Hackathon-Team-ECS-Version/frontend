import { useAppStore } from "../../store/useAppStore";

export function Header() {
  const availableIfcPaths = useAppStore((state) => state.availableIfcPaths);
  const selectedFilePath = useAppStore((state) => state.selectedFilePath);
  const setSelectedFilePath = useAppStore((state) => state.setSelectedFilePath);

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <div className="topbar__kicker">Hackathon concept</div>
        <h1>IFC Git Viewer</h1>
        <p>Scrub through commits and watch the building respond to version history.</p>
      </div>

      <div className="topbar__controls">
        <label className="field field--model">
          <span className="field__label">Model</span>
          <select
            value={selectedFilePath ?? ""}
            onChange={(event) => setSelectedFilePath(event.target.value || null)}
            disabled={availableIfcPaths.length === 0}
          >
            <option value="" disabled>
              Select IFC model
            </option>
            {availableIfcPaths.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}
