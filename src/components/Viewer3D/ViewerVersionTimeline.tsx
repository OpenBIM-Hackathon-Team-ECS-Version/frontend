import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { importBcfProject, listTopics } from "../../lib/bcf";
import {
  buildTopicHistoryByGuid,
  buildTopicLifecycle,
  getTopicStateAtCommit,
  getTopicAnchorTimestamp,
  isResolvedStatus,
  resolveHistoryCommitSha,
  resolveTopicCommitSha,
  type TopicHistoryEntry,
} from "../../lib/bcfTimeline";
import { fetchRepoFileBuffer, getFileCommitHistory, mergeBranchCommits } from "../../lib/github";
import { useAppStore } from "../../store/useAppStore";
import type { GitCommit } from "../../types/git";
import type { BCFProject, BCFTopic } from "../../types/bcf";

const commitTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatCommitTimestamp(authoredAt: string) {
  const timestamp = new Date(authoredAt);
  return Number.isNaN(timestamp.getTime()) ? authoredAt : commitTimestampFormatter.format(timestamp);
}

type TimelineTopicMarker = {
  commitSha: string;
  topic: BCFTopic;
  stateTopic: BCFTopic;
  markerIndex: string;
  rowIndex: number;
};

export function ViewerVersionTimeline() {
  const repo = useAppStore((state) => state.repo);
  const authToken = useAppStore((state) => state.authToken);
  const activeSha = useAppStore((state) => state.activeSha);
  const activePath = useAppStore((state) => state.activePath);
  const branches = useAppStore((state) => state.branches);
  const selectedBranch = useAppStore((state) => state.selectedBranch);
  const availableBcfFiles = useAppStore((state) => state.availableBcfFiles);
  const bcfSourceName = useAppStore((state) => state.bcfSourceName);
  const selectedTopicGuid = useAppStore((state) => state.selectedTopicGuid);
  const setActiveSha = useAppStore((state) => state.setActiveSha);
  const setSelectedTopicGuid = useAppStore((state) => state.setSelectedTopicGuid);
  const setSelectedViewpointGuid = useAppStore((state) => state.setSelectedViewpointGuid);

  const [versions, setVersions] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [visibleVersionSha, setVisibleVersionSha] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(6);
  const [historyBcfProject, setHistoryBcfProject] = useState<BCFProject | null>(null);
  const [topicHistoryByGuid, setTopicHistoryByGuid] = useState<Map<string, TopicHistoryEntry[]>>(new Map());

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

  const totalPages = Math.max(Math.ceil(versions.length / pageSize), 1);
  const clampedPage = Math.min(page, totalPages - 1);
  const visibleVersions = useMemo(() => {
    const start = clampedPage * pageSize;
    return versions.slice(start, start + pageSize);
  }, [clampedPage, pageSize, versions]);
  const topics = useMemo(() => listTopics(historyBcfProject), [historyBcfProject]);
  const selectedBcfFile = useMemo(
    () => availableBcfFiles.find((file) => file.path === bcfSourceName) ?? null,
    [availableBcfFiles, bcfSourceName],
  );

  useEffect(() => {
    if (!repo || !selectedBcfFile) {
      setHistoryBcfProject(null);
      return;
    }

    let cancelled = false;
    const resolvedRepo = repo;
    const resolvedBcfPath = selectedBcfFile.path;
    const resolvedBcfRef = selectedBcfFile.sha;

    async function loadHistoryBcfProject() {
      try {
        const buffer = await fetchRepoFileBuffer(
          resolvedRepo,
          resolvedBcfRef,
          resolvedBcfPath,
          authToken,
        );
        const project = await importBcfProject(buffer);
        if (!cancelled) {
          setHistoryBcfProject(project);
        }
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setHistoryBcfProject(null);
        }
      }
    }

    void loadHistoryBcfProject();

    return () => {
      cancelled = true;
    };
  }, [authToken, repo, selectedBcfFile]);

  useEffect(() => {
    if (!repo || !selectedBcfFile || topics.length === 0) {
      setTopicHistoryByGuid(new Map());
      return;
    }

    let cancelled = false;
    const topicGuids = new Set(topics.map((topic) => topic.guid));
    const resolvedRepo = repo;
    const resolvedBcfPath = selectedBcfFile.path;
    const resolvedBcfRef = selectedBranch ?? selectedBcfFile.branch;

    async function loadTopicHistory() {
      try {
        if (cancelled) {
          return;
        }

        const historyByGuid = await buildTopicHistoryByGuid({
          authToken,
          bcfPath: resolvedBcfPath,
          bcfRef: resolvedBcfRef,
          repo: resolvedRepo,
          topics: topics.filter((topic) => topicGuids.has(topic.guid)),
        });

        if (cancelled) {
          return;
        }

        if (!cancelled) {
          setTopicHistoryByGuid(historyByGuid);
        }
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setTopicHistoryByGuid(new Map<string, TopicHistoryEntry[]>());
        }
      }
    }

    void loadTopicHistory();

    return () => {
      cancelled = true;
    };
  }, [authToken, repo, selectedBcfFile, selectedBranch, topics]);

  const topicsByVisibleSha = useMemo(() => {
    const grouped = new Map<string, TimelineTopicMarker[]>();
    const versionIndexBySha = new Map(versions.map((commit, index) => [commit.sha, index]));
    const activeIndex = activeSha ? versionIndexBySha.get(activeSha) ?? null : null;
    const laneTopics = topics
      .filter((topic) => {
        const anchorSha = resolveTopicCommitSha(topic, versions, topicHistoryByGuid);
        if (!anchorSha) {
          return false;
        }

        const startIndex = versionIndexBySha.get(anchorSha);
        return startIndex !== undefined && (activeIndex === null || startIndex <= activeIndex);
      })
      .slice()
      .sort((left, right) => {
        const leftAnchor = resolveTopicCommitSha(left, versions, topicHistoryByGuid);
        const rightAnchor = resolveTopicCommitSha(right, versions, topicHistoryByGuid);
        const leftIndex = leftAnchor ? versionIndexBySha.get(leftAnchor) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
        const rightIndex = rightAnchor ? versionIndexBySha.get(rightAnchor) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;

        if (leftIndex !== rightIndex) {
          return leftIndex - rightIndex;
        }

        const leftTimestamp = getTopicAnchorTimestamp(left) ?? 0;
        const rightTimestamp = getTopicAnchorTimestamp(right) ?? 0;
        return leftTimestamp - rightTimestamp;
      });
    const rowIndexByGuid = new Map(laneTopics.map((topic, index) => [topic.guid, index + 1]));

    visibleVersions.forEach((commit) => {
      grouped.set(commit.sha, []);
    });

    topics.forEach((topic) => {
      const anchorSha = resolveTopicCommitSha(topic, versions, topicHistoryByGuid);
      if (!anchorSha) {
        return;
      }

      const startIndex = versionIndexBySha.get(anchorSha);
      if (startIndex === undefined) {
        return;
      }

      const history = topicHistoryByGuid.get(topic.guid) ?? [];
      const resolvedEntry = history.find((entry) => isResolvedStatus(entry.topic.topicStatus));
      const resolvedSha = resolvedEntry ? resolveHistoryCommitSha(resolvedEntry.commit, versions) : null;
      const resolvedIndex = resolvedSha ? versionIndexBySha.get(resolvedSha) ?? null : null;

      visibleVersions.forEach((commit) => {
        const commitIndex = versionIndexBySha.get(commit.sha);
        if (commitIndex === undefined || commitIndex < startIndex) {
          return;
        }

        if (activeIndex !== null && commitIndex > activeIndex && startIndex > activeIndex) {
          return;
        }

        const stateTopic = getTopicStateAtCommit(topic, commit.sha, versions, topicHistoryByGuid);
        const isResolvedAtCommit = isResolvedStatus(stateTopic.topicStatus);
        if (isResolvedAtCommit && commit.sha !== anchorSha) {
          if (resolvedSha !== commit.sha) {
            return;
          }
        }

        if (isResolvedAtCommit && commitIndex > startIndex) {
          if (resolvedSha !== commit.sha) {
            return;
          }
        }

        if (!isResolvedAtCommit) {
          if (resolvedIndex !== null && commitIndex > resolvedIndex) {
            return;
          }
        }

        if (isResolvedAtCommit && commitIndex < startIndex) {
          return;
        }

        const bucket = grouped.get(commit.sha);
        if (!bucket) {
          return;
        }

        bucket.push({
          commitSha: commit.sha,
          topic,
          stateTopic,
          markerIndex: topic.index ? String(topic.index) : "",
          rowIndex: rowIndexByGuid.get(topic.guid) ?? 1,
        });
      });
    });

    grouped.forEach((bucket) => {
      bucket.sort((left, right) => left.rowIndex - right.rowIndex);
    });

    return grouped;
  }, [activeSha, topicHistoryByGuid, topics, versions, visibleVersions]);
  const markerRowCount = useMemo(() => {
    const versionIndexBySha = new Map(versions.map((commit, index) => [commit.sha, index]));
    const activeIndex = activeSha ? versionIndexBySha.get(activeSha) ?? null : null;

    return Math.max(
      topics.filter((topic) => {
        const anchorSha = resolveTopicCommitSha(topic, versions, topicHistoryByGuid);
        if (!anchorSha) {
          return false;
        }

        const startIndex = versionIndexBySha.get(anchorSha);
        return startIndex !== undefined && (activeIndex === null || startIndex <= activeIndex);
      }).length,
      1,
    );
  }, [activeSha, topicHistoryByGuid, topics, versions]);

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

  useEffect(() => {
    if (!selectedTopicGuid) {
      return;
    }

    const topic = topics.find((entry) => entry.guid === selectedTopicGuid);
    const lifecycle = topic ? buildTopicLifecycle(topic, versions, topicHistoryByGuid) : null;
    const targetSha =
      activeSha && lifecycle?.visibleCommitShas.includes(activeSha)
        ? activeSha
        : lifecycle?.visibleCommitShas[lifecycle.visibleCommitShas.length - 1] ?? null;
    if (!targetSha) {
      return;
    }

    const topicIndex = versions.findIndex((commit) => commit.sha === targetSha);
    if (topicIndex < 0) {
      return;
    }

    const nextPage = Math.floor(topicIndex / pageSize);
    setPage((currentPage) => (currentPage === nextPage ? currentPage : nextPage));
  }, [activeSha, pageSize, selectedTopicGuid, topicHistoryByGuid, topics, versions]);

  return (
    <div className="version-strip">
      <div className="version-strip__header">
        <div className="version-strip__title">
          <h2 className="panel__title">Timeline</h2>
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
          style={{
            "--history-columns": String(pageSize),
            "--history-marker-rows": String(markerRowCount),
          } as CSSProperties}
        >
          <div className="version-strip__markers" aria-label="BCF issues on timeline">
            {visibleVersions.map((commit) => {
              const commitTopics = topicsByVisibleSha.get(commit.sha) ?? [];

              return (
                <div key={`bcf-${commit.sha}`} className="version-strip__marker-column">
                  {commitTopics.length > 0 ? (
                    <>
                      {commitTopics.map(({ topic, stateTopic, markerIndex, rowIndex }) => (
                      <button
                        key={topic.guid}
                        type="button"
                        className={`version-bcf-marker ${isResolvedStatus(stateTopic.topicStatus) ? "version-bcf-marker--resolved" : "version-bcf-marker--open"} ${topic.guid === selectedTopicGuid ? "is-active" : ""}`}
                        style={{ gridRow: String(markerRowCount - rowIndex + 1) }}
                        title={`${topic.title} · ${stateTopic.topicStatus ?? "Open"} · ${commit.shortSha}`}
                        onClick={() => {
                          setActiveSha(commit.sha);
                          setSelectedTopicGuid(topic.guid);
                          setSelectedViewpointGuid(topic.viewpoints[0]?.guid ?? null);
                        }}
                      >
                        <span className="version-bcf-marker__index" aria-hidden="true">
                          {isResolvedStatus(stateTopic.topicStatus) ? "✓" : markerIndex || "•"}
                        </span>
                        <span className="version-bcf-marker__label">{topic.title}</span>
                      </button>
                      ))}
                    </>
                  ) : (
                    <span className="version-strip__marker-empty" aria-hidden="true" />
                  )}
                </div>
              );
            })}
          </div>

          {visibleVersions.map((commit, index) => (
            <button
              key={commit.sha}
              type="button"
              className={`version-stop ${commit.sha === visibleVersionSha ? "is-active" : ""}`}
              onClick={() => setActiveSha(commit.sha)}
              title={`${commit.shortSha} — ${commit.message.split("\n")[0]} — ${formatCommitTimestamp(commit.authoredAt)}`}
              aria-label={`Show version ${commit.shortSha}`}
            >
              <span className="version-stop__badge">
                {clampedPage === 0 && index === 0
                  ? "Start"
                  : clampedPage === totalPages - 1 && index === visibleVersions.length - 1
                    ? "Latest"
                    : "Version"}
              </span>
              <strong>{formatCommitTimestamp(commit.authoredAt)}</strong>
              <span className="version-stop__meta">
                {commit.shortSha}
              </span>
              <p>{commit.message.split("\n")[0]}</p>
              <span className="version-stop__meta version-stop__meta--secondary">
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
