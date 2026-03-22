import { useEffect, useMemo, useState } from "react";

import { getFileCommitHistory } from "../../lib/github";
import { useAppStore } from "../../store/useAppStore";
import type { GitCommit } from "../../types/git";

export function ViewerVersionTimeline() {
  const repo = useAppStore((state) => state.repo);
  const authToken = useAppStore((state) => state.authToken);
  const activePath = useAppStore((state) => state.activePath);
  const activeSha = useAppStore((state) => state.activeSha);
  const selectedBranch = useAppStore((state) => state.selectedBranch);
  const commitMap = useAppStore((state) => state.commitMap);
  const setActiveSha = useAppStore((state) => state.setActiveSha);

  const [versions, setVersions] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [visibleVersionSha, setVisibleVersionSha] = useState<string | null>(null);

  useEffect(() => {
    const historyRef = selectedBranch ?? activeSha;
    if (!repo || !activePath || !historyRef) {
      setVersions([]);
      setLoading(false);
      setVisibleVersionSha(null);
      return;
    }

    let cancelled = false;
    const resolvedRepo = repo;
    const resolvedActivePath = activePath;
    const resolvedHistoryRef = historyRef;

    async function loadVersions() {
      setLoading(true);

      try {
        const [history, visibleHistory] = await Promise.all([
          getFileCommitHistory(resolvedRepo, resolvedHistoryRef, resolvedActivePath, authToken, 20),
          activeSha
            ? getFileCommitHistory(resolvedRepo, activeSha, resolvedActivePath, authToken, 1)
            : Promise.resolve([]),
        ]);
        if (cancelled) {
          return;
        }

        setVersions(history.slice().reverse());
        setVisibleVersionSha(visibleHistory[0]?.sha ?? null);
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error(error);
        setVersions([]);
        setVisibleVersionSha(null);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadVersions();

    return () => {
      cancelled = true;
    };
  }, [activePath, activeSha, authToken, repo, selectedBranch]);

  const activeBranchCommit = useMemo(
    () => (activeSha ? commitMap.get(activeSha) ?? null : null),
    [activeSha, commitMap],
  );
  const activeVersionCommit = useMemo(
    () => versions.find((commit) => commit.sha === visibleVersionSha) ?? null,
    [versions, visibleVersionSha],
  );
  const activeCommit = useMemo(
    () => versions.find((commit) => commit.sha === activeSha) ?? null,
    [activeSha, versions],
  );

  return (
    <div className="version-strip">
      <div className="version-strip__header">
        <div>
          <span className="version-strip__label">Model history</span>
          <strong>{activePath ?? "No IFC file selected yet"}</strong>
        </div>
        <div className="version-strip__meta">
          <span>{loading ? "Loading versions..." : `${versions.length} versions`}</span>
          <span>
            {activeVersionCommit
              ? `Visible version ${activeVersionCommit.shortSha}`
              : activeCommit
                ? `Viewing commit ${activeCommit.shortSha}`
                : "Select a version"}
          </span>
        </div>
      </div>

      <div className="version-strip__summary">
        <div className="version-strip__summary-card">
          <span>Branch commit</span>
          <strong>{activeBranchCommit?.shortSha ?? "—"}</strong>
          <p>{activeBranchCommit?.message.split("\n")[0] ?? "Pick a commit to inspect this IFC state."}</p>
        </div>
        <div className="version-strip__summary-card">
          <span>File version</span>
          <strong>{activeVersionCommit?.shortSha ?? "—"}</strong>
          <p>
            {activeVersionCommit
              ? `${activeVersionCommit.authorName} · ${activeVersionCommit.relativeTime}`
              : "Each dot below is a real saved revision of the selected IFC file."}
          </p>
        </div>
      </div>

      <div className="version-strip__track">
        <div className="version-strip__line" />
        <div className="version-strip__dots">
          {versions.length > 0 ? (
            versions.map((commit, index) => (
              <button
                key={commit.sha}
                type="button"
                className={`version-stop ${commit.sha === visibleVersionSha ? "is-active" : ""}`}
                onClick={() => setActiveSha(commit.sha)}
                title={`${commit.shortSha} — ${commit.message.split("\n")[0]}`}
                aria-label={`Show version ${commit.shortSha}`}
              >
                <span className="version-stop__badge">
                  {index === 0 ? "Start" : index === versions.length - 1 ? "Latest" : "Version"}
                </span>
                <strong>{commit.shortSha}</strong>
                <p>{commit.message.split("\n")[0]}</p>
                <span className="version-stop__meta">{commit.relativeTime}</span>
                <span className="version-stop__dot" />
              </button>
            ))
          ) : (
            <div className="version-strip__empty">
              {activePath
                ? "No IFC revision history found for this file yet."
                : "Choose an IFC file to see its version history."}
            </div>
          )}
        </div>
      </div>

      <div className="version-strip__caption">
        {activeVersionCommit
          ? `Showing file revision ${activeVersionCommit.shortSha} from ${activeVersionCommit.message.split("\n")[0]}`
          : activeCommit
            ? `Viewing branch commit ${activeCommit.shortSha} - ${activeCommit.message.split("\n")[0]}`
            : "Each dot represents a saved version of the selected IFC file."}
      </div>
    </div>
  );
}
