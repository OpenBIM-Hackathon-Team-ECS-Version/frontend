import { useEffect, useRef } from "react";

import { Header } from "./components/Header/Header";
import { GitGraph } from "./components/GitGraph/GitGraph";
import { PropertiesPanel } from "./components/PropertiesPanel/PropertiesPanel";
import { Viewer3D } from "./components/Viewer3D/Viewer3D";
import { ViewerVersionTimeline } from "./components/Viewer3D/ViewerVersionTimeline";
import { useGitHub } from "./hooks/useGitHub";
import { useAppStore } from "./store/useAppStore";

export default function App() {
  const autoConnectAttemptedRef = useRef(false);
  const branches = useAppStore((state) => state.branches);
  const commits = useAppStore((state) => state.commits);
  const activeSha = useAppStore((state) => state.activeSha);
  const repo = useAppStore((state) => state.repo);

  const { connectRepo, selectBranch, loadIfcPathsForSha, isConnecting, error } = useGitHub();

  useEffect(() => {
    if (autoConnectAttemptedRef.current) {
      return;
    }

    if (!repo && !isConnecting) {
      autoConnectAttemptedRef.current = true;
      void connectRepo();
    }
  }, [connectRepo, isConnecting, repo]);

  return (
    <div className="app-shell">
      <Header
        isConnecting={isConnecting}
        error={error}
        onConnect={connectRepo}
        onBranchChange={selectBranch}
      />

      <main className="workspace-grid">
        <section className="workspace-grid__left">
          <div className="overview-strip">
            <div className="overview-card">
              <span>Branches</span>
              <strong>{branches.length}</strong>
            </div>
            <div className="overview-card">
              <span>Commits in graph</span>
              <strong>{commits.length}</strong>
            </div>
            <div className="overview-card">
              <span>Active commit</span>
              <strong>{activeSha?.slice(0, 7) ?? "—"}</strong>
            </div>
          </div>

          <GitGraph />
        </section>

        <section className="workspace-grid__center">
          <Viewer3D loadIfcPathsForSha={loadIfcPathsForSha} />
          <ViewerVersionTimeline />
        </section>

        <PropertiesPanel />
      </main>
    </div>
  );
}
