import { useEffect, useRef } from "react";

import { BcfPanel } from "./components/BcfPanel/BcfPanel";
import { Header } from "./components/Header/Header";
import { PropertiesPanel } from "./components/PropertiesPanel/PropertiesPanel";
import { Viewer3D } from "./components/Viewer3D/Viewer3D";
import { ViewerVersionTimeline } from "./components/Viewer3D/ViewerVersionTimeline";
import { useGitHub } from "./hooks/useGitHub";
import { useTheme } from "./hooks/useTheme";
import { useAppStore } from "./store/useAppStore";

export default function App() {
  const autoConnectAttemptedRef = useRef(false);
  const repo = useAppStore((state) => state.repo);

  const { connectRepo, loadIfcPathsForSha, isConnecting } = useGitHub();
  const { theme, toggleTheme } = useTheme();

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
      <Header theme={theme} onToggleTheme={toggleTheme} />

      <main className="workspace-grid">
        <section className="workspace-grid__graph">
          <BcfPanel />
        </section>

        <section className="workspace-grid__viewer">
          <Viewer3D loadIfcPathsForSha={loadIfcPathsForSha} theme={theme} />
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
