import { SAMPLE_REPO_URL } from "../../lib/github";
import { useAppStore } from "../../store/useAppStore";

interface HeaderProps {
  isConnecting: boolean;
  error: string | null;
  onConnect: () => Promise<void>;
  onBranchChange: (branchName: string) => Promise<void>;
}

export function Header({ isConnecting, error, onConnect, onBranchChange }: HeaderProps) {
  const repoInput = useAppStore((state) => state.repoInput);
  const authToken = useAppStore((state) => state.authToken);
  const repo = useAppStore((state) => state.repo);
  const branches = useAppStore((state) => state.branches);
  const selectedBranch = useAppStore((state) => state.selectedBranch);
  const availableIfcPaths = useAppStore((state) => state.availableIfcPaths);
  const selectedFilePath = useAppStore((state) => state.selectedFilePath);
  const setAuthToken = useAppStore((state) => state.setAuthToken);
  const setSelectedFilePath = useAppStore((state) => state.setSelectedFilePath);

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <div className="topbar__kicker">Hackathon concept</div>
        <h1>IFC Git Viewer</h1>
        <p>Scrub through commits and watch the building respond to version history.</p>
      </div>

      <div className="topbar__controls">
        <label className="field">
          <span className="field__label">Repository</span>
          <input
            value={repoInput}
            readOnly
            title={SAMPLE_REPO_URL}
          />
        </label>

        <label className="field">
          <span className="field__label">Token</span>
          <input
            type="password"
            value={authToken}
            onChange={(event) => setAuthToken(event.target.value)}
            placeholder="Optional PAT for higher rate limits"
          />
        </label>

        <label className="field field--compact">
          <span className="field__label">Branch</span>
          <select
            value={selectedBranch ?? ""}
            onChange={(event) => void onBranchChange(event.target.value)}
            disabled={branches.length === 0}
          >
            <option value="" disabled>
              Select branch
            </option>
            {branches.map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field field--compact">
          <span className="field__label">IFC file</span>
          <select
            value={selectedFilePath ?? ""}
            onChange={(event) => setSelectedFilePath(event.target.value)}
            disabled={availableIfcPaths.length === 0}
          >
            <option value="" disabled>
              Select .ifc
            </option>
            {availableIfcPaths.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="connect-button"
          onClick={() => void onConnect()}
          disabled={isConnecting}
        >
          {isConnecting ? "Connecting..." : "Load sample repo"}
        </button>
      </div>

      <div className="topbar__status">
        <span className={`status-pill ${repo ? "is-live" : ""}`}>
          {repo ? `${repo.owner}/${repo.name}` : "No repo connected"}
        </span>
        <span className={`status-pill ${authToken ? "is-live" : ""}`}>
          {authToken ? "Token ready" : "Anonymous GitHub mode"}
        </span>
        {error ? <span className="status-pill status-pill--error">{error}</span> : null}
      </div>
    </header>
  );
}
