import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { getFileCommitHistory, mergeBranchCommits } from "../../lib/github";
import { useAppStore } from "../../store/useAppStore";
import type { GitCommit } from "../../types/git";

export function ViewerVersionTimeline() {
  const repo = useAppStore((state) => state.repo);
  const authToken = useAppStore((state) => state.authToken);
  const activePath = useAppStore((state) => state.activePath);
  const activeSha = useAppStore((state) => state.activeSha);
  const branches = useAppStore((state) => state.branches);
  const selectedBranch = useAppStore((state) => state.selectedBranch);
  const setActiveSha = useAppStore((state) => state.setActiveSha);

  const [versions, setVersions] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [visibleVersionSha, setVisibleVersionSha] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(6);

  useEffect(() => {
    if (!repo || !activePath) {
      setVersions([]);
      setLoading(false);
      setVisibleVersionSha(null);
      setPage(0);
      return;
    }

    let cancelled = false;
    const resolvedRepo = repo;
    const resolvedActivePath = activePath;
    const prioritizedBranches =
      selectedBranch
        ? branches.filter((branch) => branch.name === selectedBranch)
        : branches.slice(0, 6);

    async function loadVersions() {
      setLoading(true);

      try {
        const [historyByBranch, visibleHistory] = await Promise.all([
          Promise.all(
            prioritizedBranches.map(async (branch) => [
              branch.name,
              await getFileCommitHistory(
                resolvedRepo,
                branch.name,
                resolvedActivePath,
                authToken,
                20,
              ),
            ] as const),
          ),
          activeSha
            ? getFileCommitHistory(resolvedRepo, activeSha, resolvedActivePath, authToken, 1)
            : Promise.resolve([]),
        ]);
        if (cancelled) {
          return;
        }

        const mergedHistory = mergeBranchCommits(Object.fromEntries(historyByBranch));
        setVersions(mergedHistory.slice().reverse());
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
  }, [activePath, activeSha, authToken, branches, repo, selectedBranch]);

  useEffect(() => {
    function updatePageSize() {
      if (window.innerWidth >= 1800) {
        setPageSize(7);
        return;
      }

      if (window.innerWidth >= 1440) {
        setPageSize(6);
        return;
      }

      if (window.innerWidth >= 1100) {
        setPageSize(5);
        return;
      }

      if (window.innerWidth >= 860) {
        setPageSize(4);
        return;
      }

      setPageSize(2);
    }

    updatePageSize();
    window.addEventListener("resize", updatePageSize);
    return () => window.removeEventListener("resize", updatePageSize);
  }, []);

  const activeVersionCommit = useMemo(
    () => versions.find((commit) => commit.sha === visibleVersionSha) ?? null,
    [versions, visibleVersionSha],
  );
  const activeCommit = useMemo(
    () => versions.find((commit) => commit.sha === activeSha) ?? null,
    [activeSha, versions],
  );
  const totalPages = Math.max(Math.ceil(versions.length / pageSize), 1);
  const clampedPage = Math.min(page, totalPages - 1);
  const visibleVersions = useMemo(() => {
    const start = clampedPage * pageSize;
    return versions.slice(start, start + pageSize);
  }, [clampedPage, pageSize, versions]);

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages - 1));
  }, [totalPages]);

  useEffect(() => {
    if (!visibleVersionSha) {
      return;
    }

    const activeIndex = versions.findIndex((commit) => commit.sha === visibleVersionSha);
    if (activeIndex < 0) {
      return;
    }

    const nextPage = Math.floor(activeIndex / pageSize);
    setPage((currentPage) => (currentPage === nextPage ? currentPage : nextPage));
  }, [pageSize, versions, visibleVersionSha]);

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

      {totalPages > 1 ? (
        <div className="version-strip__toolbar">
          <div className="version-strip__page-copy">Page {clampedPage + 1} of {totalPages}</div>
          <div className="version-strip__nav">
            <button
              type="button"
              className="version-strip__nav-button"
              onClick={() => setPage((currentPage) => Math.max(currentPage - 1, 0))}
              disabled={clampedPage === 0}
            >
              Prev
            </button>
            <button
              type="button"
              className="version-strip__nav-button"
              onClick={() => setPage((currentPage) => Math.min(currentPage + 1, totalPages - 1))}
              disabled={clampedPage >= totalPages - 1}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      {versions.length > 0 ? (
        <div
          className="version-strip__carousel"
          style={{ "--history-columns": String(pageSize) } as CSSProperties}
        >
          {visibleVersions.map((commit, index) => (
            <button
              key={commit.sha}
              type="button"
              className={`version-stop ${commit.sha === visibleVersionSha ? "is-active" : ""}`}
              onClick={() => setActiveSha(commit.sha)}
              title={`${commit.shortSha} — ${commit.message.split("\n")[0]}`}
              aria-label={`Show version ${commit.shortSha}`}
            >
              <span className="version-stop__badge">
                {clampedPage === 0 && index === 0
                  ? "Start"
                  : clampedPage === totalPages - 1 && index === visibleVersions.length - 1
                    ? "Latest"
                    : "Version"}
              </span>
              <strong>{commit.shortSha}</strong>
              <p>{commit.message.split("\n")[0]}</p>
              <span className="version-stop__meta">
                {commit.authorName} · {commit.relativeTime}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="version-strip__empty">
          {activePath
            ? "No IFC revision history found for this file yet."
            : "Choose an IFC file to see its version history."}
        </div>
      )}
    </div>
  );
}
