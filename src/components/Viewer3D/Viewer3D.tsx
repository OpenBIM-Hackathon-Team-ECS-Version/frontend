import { useIfcDiff } from "../../hooks/useIfcDiff";
import { useIfcLoader } from "../../hooks/useIfcLoader";
import type { Theme } from "../../hooks/useTheme";
import { useAppStore } from "../../store/useAppStore";
import { useViewer } from "./useViewer";

interface Viewer3DProps {
  loadIfcPathsForSha: (sha: string) => Promise<string[]>;
  theme: Theme;
}

export function Viewer3D({ loadIfcPathsForSha, theme }: Viewer3DProps) {
  const webGpuSupported = useAppStore((state) => state.webGpuSupported);
  const viewerReady = useAppStore((state) => state.viewerReady);
  const loading = useAppStore((state) => state.loading);
  const loadProgress = useAppStore((state) => state.loadProgress);
  const loadError = useAppStore((state) => state.loadError);
  const entityCount = useAppStore((state) => state.entityCount);
  const activePath = useAppStore((state) => state.activePath);

  const { canvasHandlers, canvasRef, stageRef, loadIfc, applyDiff, handleCanvasClick } = useViewer(theme);

  useIfcLoader(loadIfc, loadIfcPathsForSha);
  useIfcDiff(applyDiff, viewerReady);

  return (
    <section className="viewer">
      <div className="viewer__hud">
        <div>
          <div className="panel__eyebrow">3D viewer</div>
          <h2>{activePath ?? "Waiting for an IFC commit"}</h2>
        </div>
        <div className="viewer__stats">
          <span>{entityCount.toLocaleString()} entities</span>
          <span>{viewerReady ? "WebGPU ready" : "Booting viewer"}</span>
        </div>
      </div>

      {!webGpuSupported ? (
        <div className="viewer__fallback">
          <h3>WebGPU is not available in this browser.</h3>
          <p>Use a recent Chrome, Edge, or Safari build to render IFC geometry.</p>
        </div>
      ) : (
        <>
          <div ref={stageRef} className="viewer__stage">
            <canvas
              ref={canvasRef}
              className="viewer__canvas"
              onClick={(event) => void handleCanvasClick(event)}
              {...canvasHandlers}
            />

            {loading ? (
              <div className="viewer__overlay">
                <div className="viewer__loader">
                  <span>Loading IFC</span>
                  <strong>{Math.round(loadProgress)}%</strong>
                </div>
              </div>
            ) : null}

            {loadError ? (
              <div className="viewer__message viewer__message--error">{loadError}</div>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
