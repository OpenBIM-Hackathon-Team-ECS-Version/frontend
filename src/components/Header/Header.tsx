import { useAppStore } from "../../store/useAppStore";
import type { Theme } from "../../hooks/useTheme";

interface HeaderProps {
  theme: Theme;
  onToggleTheme: () => void;
}

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === "light") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4.5" />
        <path d="M12 1.75v3.1M12 19.15v3.1M4.76 4.76l2.2 2.2M17.04 17.04l2.2 2.2M1.75 12h3.1M19.15 12h3.1M4.76 19.24l2.2-2.2M17.04 6.96l2.2-2.2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.25 14.18A8.75 8.75 0 0 1 9.82 3.75a8.75 8.75 0 1 0 10.43 10.43Z" />
    </svg>
  );
}

export function Header({ theme, onToggleTheme }: HeaderProps) {
  const availableIfcPaths = useAppStore((state) => state.availableIfcPaths);
  const selectedFilePath = useAppStore((state) => state.selectedFilePath);
  const diffHighlightEnabled = useAppStore((state) => state.diffHighlightEnabled);
  const diffGhostNonAffectedEnabled = useAppStore((state) => state.diffGhostNonAffectedEnabled);
  const diffResult = useAppStore((state) => state.diffResult);
  const setSelectedFilePath = useAppStore((state) => state.setSelectedFilePath);
  const setDiffHighlightEnabled = useAppStore((state) => state.setDiffHighlightEnabled);
  const setDiffGhostNonAffectedEnabled = useAppStore((state) => state.setDiffGhostNonAffectedEnabled);
  const diffControlsEnabled = Boolean(diffResult) && diffHighlightEnabled;

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <div className="topbar__brand-head">
          <div className="topbar__brand-title">
            <h1>
              <span>BCF &lt;&lt;</span>
              <sup>Time Machine</sup>
            </h1>
          </div>

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

        <div className="topbar__brand-meta">
          <p>Review BIM issues across version history.</p>
        </div>
      </div>

      <div className="topbar__controls">
        <div className="topbar__utility-row">
          <button
            type="button"
            className="theme-toggle"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            <span className="theme-toggle__icon">
              <ThemeIcon theme={theme} />
            </span>
            <span className="theme-toggle__copy">
              <span className="theme-toggle__eyebrow">Theme</span>
              <strong>{theme === "dark" ? "Dark mode" : "Light mode"}</strong>
            </span>
          </button>

          <div className="topbar__inspection" aria-label="Inspection controls">
            <label className="topbar-toggle">
              <span className="topbar-toggle__label">Diff coloring</span>
              <input
                type="checkbox"
                checked={diffHighlightEnabled}
                onChange={(event) => setDiffHighlightEnabled(event.target.checked)}
              />
            </label>

            <label className={`topbar-toggle ${!diffControlsEnabled ? "is-disabled" : ""}`}>
              <span className="topbar-toggle__label">Ghost context</span>
              <input
                type="checkbox"
                checked={diffGhostNonAffectedEnabled}
                disabled={!diffControlsEnabled}
                onChange={(event) => setDiffGhostNonAffectedEnabled(event.target.checked)}
              />
            </label>
          </div>
        </div>
      </div>
    </header>
  );
}
