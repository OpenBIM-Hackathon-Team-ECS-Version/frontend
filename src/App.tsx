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
  const repo = useAppStore((state) => state.repo);

  const { connectRepo, loadIfcPathsForSha, isConnecting } = useGitHub();

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
      <Header />

      <main className="workspace-grid">
        <section className="workspace-grid__graph">
          <GitGraph />
        </section>

        <section className="workspace-grid__viewer">
          <Viewer3D loadIfcPathsForSha={loadIfcPathsForSha} />
        </section>

        <section className="workspace-grid__history">
          <ViewerVersionTimeline />
        </section>

        <section className="workspace-grid__properties">
          <PropertiesPanel />
        </section>
      </main>
    </div>
  );
}
