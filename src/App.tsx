import { useEffect } from "react";

import { Header } from "./components/Header/Header";
import { GitGraph } from "./components/GitGraph/GitGraph";
import { PropertiesPanel } from "./components/PropertiesPanel/PropertiesPanel";
import { RepoFilesPanel } from "./components/RepoFilesPanel/RepoFilesPanel";
import { Timeline } from "./components/Timeline/Timeline";
import { Viewer3D } from "./components/Viewer3D/Viewer3D";
import { useGitHub } from "./hooks/useGitHub";
import { useAppStore } from "./store/useAppStore";

export default function App() {
  const branches = useAppStore((state) => state.branches);
  const commits = useAppStore((state) => state.commits);
  const activeSha = useAppStore((state) => state.activeSha);
  const activePath = useAppStore((state) => state.activePath);
  const repo = useAppStore((state) => state.repo);

  const { connectRepo, selectBranch, loadIfcPathsForSha, isConnecting, error } = useGitHub();

  useEffect(() => {
    if (!repo && !isConnecting) {
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
          <RepoFilesPanel />
          <Timeline />
        </section>

        <section className="workspace-grid__center">
          <Viewer3D loadIfcPathsForSha={loadIfcPathsForSha} />
          <div className="footnote-bar">
            <span>Current IFC path</span>
            <strong>{activePath ?? "No IFC file selected yet"}</strong>
          </div>
        </section>

        <PropertiesPanel />
      </main>
    </div>
  );
}
