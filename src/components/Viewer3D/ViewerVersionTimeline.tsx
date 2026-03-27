import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

import { importBcfProject, listTopics } from "../../lib/bcf";
import {
  buildTopicHistoryByGuid,
  buildTopicLifecycle,
  getTopicAnchorTimestamp,
  getTopicStateAtCommit,
  isResolvedStatus,
  resolveTopicCommitSha,
  type TopicHistoryEntry,
} from "../../lib/bcfTimeline";
import { fetchRepoFileBuffer, getFileCommitHistory, mergeBranchCommits } from "../../lib/github";
import { validateFile, fetchValidationBcf, isAllPassing } from "../../lib/validation";
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

type SwimlaneDot = {
  columnIndex: number;
  commitSha: string;
  stateTopic: BCFTopic;
};

type SwimlaneLaneData = {
  topic: BCFTopic;
  markerIndex: string;
  dots: SwimlaneDot[];
  dotsByColumn: Map<number, SwimlaneDot>;
  firstColumn: number;
  lastColumn: number;
  extendsBefore: boolean;
  extendsAfter: boolean;
  isResolved: boolean;
};

const MAX_VISIBLE_LANES = 5;

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
  const validationResults = useAppStore((state) => state.validationResults);
  const validatingCommitSha = useAppStore((state) => state.validatingCommitSha);
  const setValidationResult = useAppStore((state) => state.setValidationResult);
  const setValidatingCommitSha = useAppStore((state) => state.setValidatingCommitSha);
  const setValidationBcf = useAppStore((state) => state.setValidationBcf);
  const setValidationBcfActive = useAppStore((state) => state.setValidationBcfActive);

  const [versions, setVersions] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [visibleVersionSha, setVisibleVersionSha] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(6);
  const [historyBcfProject, setHistoryBcfProject] = useState<BCFProject | null>(null);
  const [topicHistoryByGuid, setTopicHistoryByGuid] = useState<Map<string, TopicHistoryEntry[]>>(new Map());
  const [lanesExpanded, setLanesExpanded] = useState(false);

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

      setPageSize(20);
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

  const swimlanes = useMemo((): SwimlaneLaneData[] => {
    const versionIndexBySha = new Map(versions.map((commit, index) => [commit.sha, index]));
    const activeIndex = activeSha ? versionIndexBySha.get(activeSha) ?? null : null;
    const visibleColumnBySha = new Map(visibleVersions.map((commit, index) => [commit.sha, index]));
    const pageStartIndex =
      visibleVersions.length > 0 ? (versionIndexBySha.get(visibleVersions[0].sha) ?? -1) : -1;
    const pageEndIndex =
      visibleVersions.length > 0
        ? (versionIndexBySha.get(visibleVersions[visibleVersions.length - 1].sha) ?? -1)
        : -1;

    return topics
      .map((topic) => ({
        topic,
        lifecycle: buildTopicLifecycle(topic, versions, topicHistoryByGuid),
      }))
      .filter(
        (entry): entry is { topic: BCFTopic; lifecycle: NonNullable<ReturnType<typeof buildTopicLifecycle>> } =>
          Boolean(entry.lifecycle),
      )
      .filter(({ lifecycle }) => {
        const startIndex = versionIndexBySha.get(lifecycle.visibleCommitShas[0]);
        return startIndex !== undefined && (activeIndex === null || startIndex <= activeIndex);
      })
      .sort((left, right) => {
        const leftAnchor = resolveTopicCommitSha(left.topic, versions, topicHistoryByGuid);
        const rightAnchor = resolveTopicCommitSha(right.topic, versions, topicHistoryByGuid);
        const leftIndex =
          leftAnchor ? versionIndexBySha.get(leftAnchor) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
        const rightIndex =
          rightAnchor ? versionIndexBySha.get(rightAnchor) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;

        if (leftIndex !== rightIndex) {
          return leftIndex - rightIndex;
        }

        const leftTimestamp = getTopicAnchorTimestamp(left.topic) ?? 0;
        const rightTimestamp = getTopicAnchorTimestamp(right.topic) ?? 0;
        return leftTimestamp - rightTimestamp;
      })
      .map(({ topic, lifecycle }): SwimlaneLaneData | null => {
        const dots: SwimlaneDot[] = [];
        for (const sha of lifecycle.visibleCommitShas) {
          const colIdx = visibleColumnBySha.get(sha);
          if (colIdx !== undefined) {
            dots.push({
              columnIndex: colIdx,
              commitSha: sha,
              stateTopic: getTopicStateAtCommit(topic, sha, versions, topicHistoryByGuid),
            });
          }
        }

        const lifecycleStartIdx = versionIndexBySha.get(lifecycle.visibleCommitShas[0]) ?? 0;
        const lifecycleEndIdx =
          versionIndexBySha.get(lifecycle.visibleCommitShas[lifecycle.visibleCommitShas.length - 1]) ?? 0;
        const extendsBefore = pageStartIndex >= 0 && lifecycleStartIdx < pageStartIndex;
        const extendsAfter = pageEndIndex >= 0 && lifecycleEndIdx > pageEndIndex;

        if (dots.length === 0 && extendsBefore && extendsAfter) {
          return {
            topic,
            markerIndex: topic.index ? String(topic.index) : "",
            dots: [],
            dotsByColumn: new Map(),
            firstColumn: 0,
            lastColumn: visibleVersions.length - 1,
            extendsBefore: true,
            extendsAfter: true,
            isResolved: isResolvedStatus(topic.topicStatus),
          };
        }

        if (dots.length === 0) {
          return null;
        }

        const dotsByColumn = new Map(dots.map((dot) => [dot.columnIndex, dot]));
        const firstColumn = extendsBefore ? 0 : dots[0].columnIndex;
        const lastColumn = extendsAfter ? visibleVersions.length - 1 : dots[dots.length - 1].columnIndex;

        return {
          topic,
          markerIndex: topic.index ? String(topic.index) : "",
          dots,
          dotsByColumn,
          firstColumn,
          lastColumn,
          extendsBefore,
          extendsAfter,
          isResolved: isResolvedStatus(dots[dots.length - 1].stateTopic.topicStatus),
        };
      })
      .filter((lane): lane is SwimlaneLaneData => lane !== null);
  }, [activeSha, topicHistoryByGuid, topics, versions, visibleVersions]);
  const displayedLanes = lanesExpanded ? swimlanes : swimlanes.slice(0, MAX_VISIBLE_LANES);
  const overflowCount = swimlanes.length - MAX_VISIBLE_LANES;

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

  const handleValidate = useCallback(
    async (commitSha: string) => {
      if (!repo || !activePath || validatingCommitSha) {
        return;
      }

      setValidatingCommitSha(commitSha);

      try {
        const result = await validateFile(repo, commitSha, activePath);
        setValidationResult(commitSha, result);

        if (!isAllPassing(result)) {
          const bcfBuffer = await fetchValidationBcf(repo, commitSha, activePath);
          const bcfProject = await importBcfProject(bcfBuffer);
          setValidationBcf(bcfProject, `Validation @ ${commitSha.slice(0, 7)}`);
        }
      } catch (error) {
        console.error("Validation failed:", error);
      } finally {
        setValidatingCommitSha(null);
      }
    },
    [repo, activePath, validatingCommitSha, setValidatingCommitSha, setValidationResult, setValidationBcf],
  );

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
        <div className="version-strip__meta">
          <span className="version-strip__meta-pill">{loading ? "Loading..." : `${versions.length} versions`}</span>
          <span className="version-strip__meta-pill">
            {activeVersionCommit
              ? `Visible ${activeVersionCommit.shortSha}`
              : activeCommit
                ? `Viewing ${activeCommit.shortSha}`
                : "Select version"}
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
          style={{
            "--history-columns": String(pageSize),
          } as CSSProperties}
        >
          <div className="version-strip__swimlanes" aria-label="BCF issues on timeline">
            {displayedLanes.map((lane) => (
              <div
                key={lane.topic.guid}
                className={`swimlane-lane ${lane.isResolved ? "swimlane-lane--resolved" : "swimlane-lane--open"}`}
                title={lane.topic.title}
              >
                {visibleVersions.map((commit, colIdx) => {
                  const dot = lane.dotsByColumn.get(colIdx);
                  const inRange = colIdx >= lane.firstColumn && colIdx <= lane.lastColumn;
                  const isFirst = colIdx === lane.firstColumn && !lane.extendsBefore;
                  const isLast = colIdx === lane.lastColumn && !lane.extendsAfter;

                  if (!inRange) {
                    return <div key={colIdx} className="swimlane-cell" />;
                  }

                  return (
                    <div
                      key={colIdx}
                      className={[
                        "swimlane-cell",
                        "swimlane-cell--in-range",
                        isFirst && "swimlane-cell--first",
                        isLast && "swimlane-cell--last",
                        isFirst && isLast && "swimlane-cell--single",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {dot ? (
                        <button
                          type="button"
                          className={`swimlane-dot ${isResolvedStatus(dot.stateTopic.topicStatus) ? "swimlane-dot--resolved" : "swimlane-dot--open"} ${lane.topic.guid === selectedTopicGuid ? "is-active" : ""}`}
                          title={`${lane.topic.title} · ${dot.stateTopic.topicStatus ?? "Open"} · ${commit.shortSha}`}
                          onClick={() => {
                            setActiveSha(dot.commitSha);
                            setSelectedTopicGuid(lane.topic.guid);
                            setSelectedViewpointGuid(dot.stateTopic.viewpoints[0]?.guid ?? null);
                          }}
                        >
                          <span className="swimlane-dot__icon" aria-hidden="true">
                            {isResolvedStatus(dot.stateTopic.topicStatus) ? "✓" : lane.markerIndex || "•"}
                          </span>
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                {lane.lastColumn < visibleVersions.length - 1 && !lane.extendsAfter ? (
                  <span
                    className="swimlane-lane__label"
                    style={{ gridColumn: `${lane.lastColumn + 2} / -1` }}
                  >
                    {lane.topic.title}
                  </span>
                ) : null}
              </div>
            ))}
            {overflowCount > 0 ? (
              <button
                type="button"
                className="swimlane-overflow"
                onClick={() => setLanesExpanded((expanded) => !expanded)}
              >
                {lanesExpanded ? "Show less" : `+${overflowCount} more`}
              </button>
            ) : null}
          </div>

          {visibleVersions.map((commit, index) => {
            const validationResult = validationResults.get(commit.sha) ?? null;
            const isValidating = validatingCommitSha === commit.sha;

            return (
              <button
                key={commit.sha}
                type="button"
                className={`version-stop ${commit.sha === visibleVersionSha ? "is-active" : ""}`}
                onClick={() => setActiveSha(commit.sha)}
                title={`${commit.shortSha} — ${commit.message.split("\n")[0]} — ${formatCommitTimestamp(commit.authoredAt)}`}
                aria-label={`Show version ${commit.shortSha}`}
              >
                <span className="version-stop__top-row">
                  <span className="version-stop__badge">
                    {clampedPage === 0 && index === 0
                      ? "Start"
                      : clampedPage === totalPages - 1 && index === visibleVersions.length - 1
                        ? "Latest"
                        : "Version"}
                  </span>
                  {validationResult ? (
                    <span
                      className={`version-stop__validate-btn version-stop__validate-btn--result ${isAllPassing(validationResult) ? "version-stop__validate-btn--pass" : "version-stop__validate-btn--fail"}`}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setValidationBcfActive(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          setValidationBcfActive(true);
                        }
                      }}
                      title={isAllPassing(validationResult) ? "All checks passed — view in BCF panel" : "Checks failed — view in BCF panel"}
                    >
                      <span className="version-stop__validate-icon" aria-hidden="true">
                        <img src="/ifc-logo-clean.png" alt="" className="version-stop__validate-logo" />
                      </span>
                      <span className="version-stop__validate-label">
                        {isAllPassing(validationResult) ? "Passed" : "Issues"}
                      </span>
                    </span>
                  ) : (
                    <span
                      className="version-stop__validate-btn"
                      role="button"
                      tabIndex={0}
                      aria-disabled={isValidating || !activePath}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isValidating && activePath) {
                          void handleValidate(commit.sha);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          if (!isValidating && activePath) {
                            void handleValidate(commit.sha);
                          }
                        }
                      }}
                      title={`Validate ${commit.shortSha}`}
                    >
                      <span className="version-stop__validate-icon" aria-hidden="true">
                        <img src="/ifc-logo-clean.png" alt="" className="version-stop__validate-logo" />
                      </span>
                      <span className="version-stop__validate-label">
                        {isValidating ? "Checking" : "Validate"}
                      </span>
                      {isValidating ? (
                        <span className="version-stop__spinner" />
                      ) : null}
                    </span>
                  )}
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
            );
          })}
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
