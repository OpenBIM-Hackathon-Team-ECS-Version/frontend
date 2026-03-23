import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  cloneProject,
  colorOverridesToGuids,
  colorOverridesFromGuids,
  createEmptyBcfProject,
  createTopicForCurrentModel,
  downloadBlob,
  exportBcfProject,
  getGuidForExpressId,
  importBcfProject,
  listTopics,
  mapGuidsToExpressIds,
  parseTopicMetadata,
  readViewpointState,
  stripTopicMetadata,
  updateTopic,
  withTopicMetadata,
  appendComment,
  appendViewpoint,
} from "../../lib/bcf";
import { isResolvedStatus } from "../../lib/bcfTimeline";
import { fetchRepoFileBuffer, getFileCommitHistory } from "../../lib/github";
import { useAppStore } from "../../store/useAppStore";
import type { BCFTopic, BCFViewpoint, BcfPanelTopicDraft } from "../../types/bcf";

const DEFAULT_AUTHOR = "reviewer@hackporto.local";
const TOPIC_STATUS_OPTIONS = ["Open", "In progress", "Resolved", "Closed"];
const TOPIC_TYPE_OPTIONS = ["Issue", "Clash", "Question", "Request", "Task"];
const PRIORITY_OPTIONS = ["Low", "Medium", "High", "Critical"];

const EMPTY_DRAFT: BcfPanelTopicDraft = {
  title: "",
  description: "",
  topicStatus: "Open",
  topicType: "Issue",
  priority: "Medium",
  assignedTo: "",
  labels: "",
};

type BcfPanelMode = "browse" | "create";
type BcfDetailTab = "overview" | "edit" | "activity";

export function BcfPanel() {
  const repo = useAppStore((state) => state.repo);
  const authToken = useAppStore((state) => state.authToken);
  const activeSha = useAppStore((state) => state.activeSha);
  const activePath = useAppStore((state) => state.activePath);
  const availableBcfFiles = useAppStore((state) => state.availableBcfFiles);
  const bcfProject = useAppStore((state) => state.bcfProject);
  const bcfSourceName = useAppStore((state) => state.bcfSourceName);
  const bcfDirty = useAppStore((state) => state.bcfDirty);
  const selectedTopicGuid = useAppStore((state) => state.selectedTopicGuid);
  const selectedViewpointGuid = useAppStore((state) => state.selectedViewpointGuid);
  const viewerApi = useAppStore((state) => state.viewerApi);
  const currentStore = useAppStore((state) => state.currentStore);
  const selectedExpressId = useAppStore((state) => state.selectedExpressId);
  const viewerHiddenExpressIds = useAppStore((state) => state.viewerHiddenExpressIds);
  const viewerIsolatedExpressIds = useAppStore((state) => state.viewerIsolatedExpressIds);
  const viewerColoredExpressIds = useAppStore((state) => state.viewerColoredExpressIds);
  const activeSectionPlane = useAppStore((state) => state.activeSectionPlane);
  const setBcfProject = useAppStore((state) => state.setBcfProject);
  const markBcfDirty = useAppStore((state) => state.markBcfDirty);
  const setSelectedTopicGuid = useAppStore((state) => state.setSelectedTopicGuid);
  const setSelectedViewpointGuid = useAppStore((state) => state.setSelectedViewpointGuid);
  const setViewerHiddenExpressIds = useAppStore((state) => state.setViewerHiddenExpressIds);
  const setViewerIsolatedExpressIds = useAppStore((state) => state.setViewerIsolatedExpressIds);
  const setViewerColoredExpressIds = useAppStore((state) => state.setViewerColoredExpressIds);
  const setActiveSectionPlane = useAppStore((state) => state.setActiveSectionPlane);
  const setSelectedExpressId = useAppStore((state) => state.setSelectedExpressId);
  const setSelectedEntity = useAppStore((state) => state.setSelectedEntity);

  const [panelMode, setPanelMode] = useState<BcfPanelMode>("browse");
  const [detailTab, setDetailTab] = useState<BcfDetailTab>("overview");
  const [draft, setDraft] = useState<BcfPanelTopicDraft>(EMPTY_DRAFT);
  const [createDraft, setCreateDraft] = useState<BcfPanelTopicDraft>(EMPTY_DRAFT);
  const [commentDraft, setCommentDraft] = useState("");
  const [selectedRepoBcfPath, setSelectedRepoBcfPath] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [resolvedBcfVersionSha, setResolvedBcfVersionSha] = useState<string | null>(null);

  const repoBcfFiles = useMemo(
    () => availableBcfFiles.slice().sort((left, right) => right.path.localeCompare(left.path)),
    [availableBcfFiles],
  );
  const topics = useMemo(
    () =>
      listTopics(bcfProject).sort((left, right) => {
        const leftResolved = isResolvedStatus(left.topicStatus);
        const rightResolved = isResolvedStatus(right.topicStatus);
        if (leftResolved !== rightResolved) {
          return Number(leftResolved) - Number(rightResolved);
        }

        const leftTimestamp = Date.parse(left.modifiedDate ?? left.creationDate ?? "");
        const rightTimestamp = Date.parse(right.modifiedDate ?? right.creationDate ?? "");
        const safeLeftTimestamp = Number.isNaN(leftTimestamp) ? 0 : leftTimestamp;
        const safeRightTimestamp = Number.isNaN(rightTimestamp) ? 0 : rightTimestamp;
        return safeRightTimestamp - safeLeftTimestamp;
      }),
    [bcfProject],
  );
  const selectedTopic = selectedTopicGuid ? bcfProject?.topics.get(selectedTopicGuid) ?? null : null;
  const selectedMetadata = useMemo(
    () => (selectedTopic ? parseTopicMetadata(selectedTopic) : null),
    [selectedTopic],
  );
  const selectedViewpoint =
    selectedTopic?.viewpoints.find((viewpoint) => viewpoint.guid === selectedViewpointGuid) ?? null;
  const openTopicCount = useMemo(
    () => topics.filter((topic) => !isResolvedStatus(topic.topicStatus)).length,
    [topics],
  );
  const selectedTopicDirty = useMemo(
    () => (selectedTopic ? isSameDraft(draft, topicToDraft(selectedTopic)) === false : false),
    [draft, selectedTopic],
  );
  const canCreateTopic = Boolean(createDraft.title.trim() && bcfProject);
  const createDraftDirty = useMemo(() => !isSameDraft(createDraft, EMPTY_DRAFT), [createDraft]);

  useEffect(() => {
    if (!selectedTopic) {
      setDraft(EMPTY_DRAFT);
      setCommentDraft("");
      return;
    }

    setDraft(topicToDraft(selectedTopic));
    setCommentDraft("");
  }, [selectedTopic]);

  useEffect(() => {
    if (selectedTopic) {
      setPanelMode("browse");
    }
  }, [selectedTopic]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }

      setMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (repoBcfFiles.length === 0) {
      setSelectedRepoBcfPath(null);
      setResolvedBcfVersionSha(null);
      setBcfProject(null, null);
      return;
    }

    setSelectedRepoBcfPath((current) =>
      current && repoBcfFiles.some((file) => file.path === current) ? current : repoBcfFiles[0]?.path ?? null,
    );
  }, [repoBcfFiles, setBcfProject]);

  useEffect(() => {
    if (!repo || !activeSha || !selectedRepoBcfPath) {
      return;
    }

    const repoRef = repo;
    const selectedRepoBcfFile = repoBcfFiles.find((file) => file.path === selectedRepoBcfPath) ?? null;
    if (!selectedRepoBcfFile) {
      return;
    }

    const selectedRepoBcfPathRef = selectedRepoBcfFile.path;
    const activeShaRef = activeSha;
    let cancelled = false;

    async function loadRepoBcf() {
      setBusyLabel("Loading BCF for selected version");
      setError(null);

      try {
        const history = await getFileCommitHistory(
          repoRef,
          activeShaRef,
          selectedRepoBcfPathRef,
          authToken,
          1,
        );
        const historicalBcfCommit = history[0] ?? null;
        if (cancelled) {
          return;
        }

        if (!historicalBcfCommit) {
          setResolvedBcfVersionSha(null);
          setBcfProject(null, selectedRepoBcfPathRef);
          return;
        }

        const buffer = await fetchRepoFileBuffer(
          repoRef,
          historicalBcfCommit.sha,
          selectedRepoBcfPathRef,
          authToken,
        );
        const project = await importBcfProject(buffer);
        if (cancelled) {
          return;
        }

        setResolvedBcfVersionSha(historicalBcfCommit.sha);
        setBcfProject(project, selectedRepoBcfPathRef);
      } catch (caughtError) {
        if (cancelled) {
          return;
        }

        setResolvedBcfVersionSha(null);
        setError(caughtError instanceof Error ? caughtError.message : "Failed to load BCF from GitHub.");
      } finally {
        if (!cancelled) {
          setBusyLabel(null);
        }
      }
    }

    void loadRepoBcf();

    return () => {
      cancelled = true;
    };
  }, [activeSha, authToken, repo, repoBcfFiles, selectedRepoBcfPath, setBcfProject]);

  const applyProjectMutation = (mutate: (project: NonNullable<typeof bcfProject>) => void) => {
    if (!bcfProject) {
      return;
    }

    const nextProject = cloneProject(bcfProject);
    mutate(nextProject);
    setBcfProject(nextProject, bcfSourceName);
    markBcfDirty(true);
  };

  const handleExport = async () => {
    if (!bcfProject) {
      return;
    }

    setBusyLabel("Exporting BCF");
    setError(null);

    try {
      const blob = await exportBcfProject(bcfProject);
      const filename = bcfSourceName?.trim()
        ? /\.bcfzip$/i.test(bcfSourceName)
          ? bcfSourceName
          : /\.bcf$/i.test(bcfSourceName)
            ? bcfSourceName
            : `${bcfSourceName}.bcfzip`
        : "review.bcfzip";
      downloadBlob(blob, filename);
      markBcfDirty(false);
      setMenuOpen(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to export BCF.");
    } finally {
      setBusyLabel(null);
    }
  };

  const handleCreateProject = () => {
    const projectName = repo ? `${repo.owner}/${repo.name} review` : "BCF << Review";
    setBcfProject(createEmptyBcfProject(projectName), "review.bcfzip");
    setSelectedTopicGuid(null);
    setSelectedViewpointGuid(null);
    setCreateDraft(EMPTY_DRAFT);
    setPanelMode("create");
    setDetailTab("overview");
    setMenuOpen(false);
    setError(null);
  };

  const handleCreateTopic = () => {
    if (!bcfProject) {
      return;
    }

    const trimmedTitle = createDraft.title.trim();
    if (!trimmedTitle) {
      return;
    }

    const topic = createTopicForCurrentModel({
      title: trimmedTitle,
      description: createDraft.description.trim() || undefined,
      author: DEFAULT_AUTHOR,
      topicStatus: createDraft.topicStatus,
      topicType: createDraft.topicType,
      priority: createDraft.priority,
      assignedTo: createDraft.assignedTo.trim() || undefined,
      labels: parseLabels(createDraft.labels),
      metadata: {
        repoName: repo?.name ?? null,
        repoOwner: repo?.owner ?? null,
        activePath,
        activeSha,
      },
    });

    applyProjectMutation((project) => {
      project.topics.set(topic.guid, topic);
    });
    setSelectedTopicGuid(topic.guid);
    setSelectedViewpointGuid(null);
    setCreateDraft(EMPTY_DRAFT);
    setPanelMode("browse");
    setDetailTab("overview");
  };

  const handleSaveTopic = () => {
    if (!selectedTopicGuid) {
      return;
    }

    applyProjectMutation((project) => {
      const topic = project.topics.get(selectedTopicGuid);
      if (!topic) {
        return;
      }

      updateTopic(topic, {
        title: draft.title.trim() || "Untitled topic",
        description: withTopicMetadata(draft.description, {
          repoName: repo?.name ?? null,
          repoOwner: repo?.owner ?? null,
          activePath,
          activeSha,
        }),
        topicStatus: draft.topicStatus.trim() || undefined,
        topicType: draft.topicType.trim() || undefined,
        priority: draft.priority.trim() || undefined,
        assignedTo: draft.assignedTo.trim() || undefined,
        labels: parseLabels(draft.labels),
        modifiedDate: new Date().toISOString(),
        modifiedAuthor: DEFAULT_AUTHOR,
      });
    });
  };

  const handleAddComment = () => {
    const trimmedComment = commentDraft.trim();
    if (!trimmedComment || !selectedTopicGuid) {
      return;
    }

    applyProjectMutation((project) => {
      const topic = project.topics.get(selectedTopicGuid);
      if (!topic) {
        return;
      }

      appendComment(topic, {
        author: DEFAULT_AUTHOR,
        comment: trimmedComment,
        viewpointGuid: selectedViewpoint?.guid,
      });
      topic.modifiedDate = new Date().toISOString();
      topic.modifiedAuthor = DEFAULT_AUTHOR;
    });
    setCommentDraft("");
  };

  const handleCaptureViewpoint = async () => {
    if (!selectedTopicGuid || !viewerApi || !currentStore) {
      return;
    }

    setBusyLabel("Capturing viewpoint");
    setError(null);

    try {
      const camera = viewerApi.getCameraState();
      const bounds = viewerApi.getBounds();
      const snapshot = await viewerApi.captureSnapshot();
      if (!camera) {
        throw new Error("Viewer camera is not ready.");
      }

      const selectedGuids =
        selectedExpressId !== null
          ? mapIdsToGuids(currentStore, [selectedExpressId])
          : [];
      const hiddenGuids = mapIdsToGuids(currentStore, Array.from(viewerHiddenExpressIds));
      const visibleGuids = viewerIsolatedExpressIds
        ? mapIdsToGuids(currentStore, Array.from(viewerIsolatedExpressIds))
        : [];

      applyProjectMutation((project) => {
        const topic = project.topics.get(selectedTopicGuid);
        if (!topic) {
          return;
        }

        const viewpoint = appendViewpoint(topic, {
          camera,
          bounds: bounds ?? undefined,
          sectionPlane: activeSectionPlane,
          selectedGuids,
          hiddenGuids,
          visibleGuids,
          coloredGuids: colorOverridesToGuids(currentStore, viewerColoredExpressIds),
          snapshot,
        });

        topic.modifiedDate = new Date().toISOString();
        topic.modifiedAuthor = DEFAULT_AUTHOR;
        setSelectedViewpointGuid(viewpoint.guid);
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to capture viewpoint.");
    } finally {
      setBusyLabel(null);
    }
  };

  const handleApplyViewpoint = async (viewpoint: BCFViewpoint) => {
    if (!viewerApi || !currentStore) {
      return;
    }

    setBusyLabel("Applying viewpoint");
    setError(null);

    try {
      const viewpointState = readViewpointState(viewpoint, viewerApi.getBounds() ?? undefined);
      const hiddenExpressIds = new Set(mapGuidsToExpressIds(currentStore, viewpointState.hiddenGuids));
      const isolatedExpressIds = viewpointState.visibleGuids.length
        ? new Set(mapGuidsToExpressIds(currentStore, viewpointState.visibleGuids))
        : null;
      const selectedIds = mapGuidsToExpressIds(currentStore, viewpointState.selectedGuids);
      const coloredExpressIds = colorOverridesFromGuids(currentStore, viewpointState.coloredGuids);

      setViewerHiddenExpressIds(hiddenExpressIds);
      setViewerIsolatedExpressIds(isolatedExpressIds);
      setViewerColoredExpressIds(coloredExpressIds);
      setActiveSectionPlane(viewpointState.sectionPlane ?? null);
      if (viewpointState.camera) {
        viewerApi.applyCameraState(viewpointState.camera);
      } else {
        viewerApi.requestRender();
      }

      const nextSelectedExpressId = selectedIds[0] ?? null;
      setSelectedExpressId(nextSelectedExpressId);
      setSelectedEntity(null);
      if (nextSelectedExpressId !== null) {
        await viewerApi.frameExpressId(nextSelectedExpressId);
      }
      setSelectedViewpointGuid(viewpoint.guid);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to apply viewpoint.");
    } finally {
      setBusyLabel(null);
    }
  };

  return (
    <div className="panel panel--graph panel--bcf">
      <div className="panel__eyebrow">BCF panel</div>
      <div className="graph-note">
        {repoBcfFiles.length === 0
          ? "No .bcf or .bcfzip files found in the repo branches we scanned."
          : bcfProject
            ? `${topics.length} topic${topics.length === 1 ? "" : "s"} · ${openTopicCount} active · BCF @ ${resolvedBcfVersionSha?.slice(0, 7) ?? "unknown"}${bcfDirty ? " · unsaved changes" : ""}`
            : resolvedBcfVersionSha === null && activeSha
              ? `No BCF snapshot exists yet for model version ${activeSha.slice(0, 7)}.`
              : "Loading BCF issues from GitHub."}
      </div>

      <div className="bcf-shell">
        <aside className="bcf-sidebar">
          <div className="bcf-sidebar__section">
            <div className="bcf-control-bar">
              <div className="bcf-control-bar__group bcf-control-bar__group--project">
                <strong>{bcfSourceName ?? "No BCF loaded"}</strong>
                <span className="bcf-control-bar__meta">
                  {resolvedBcfVersionSha ? `Snapshot ${resolvedBcfVersionSha.slice(0, 7)}` : "No matching BCF snapshot"}
                </span>
              </div>

              <div className="bcf-mode-tabs" role="tablist" aria-label="BCF workflows">
                <button
                  type="button"
                  className={`bcf-mode-tab ${panelMode === "browse" ? "is-active" : ""}`}
                  onClick={() => setPanelMode("browse")}
                >
                  Topics
                </button>
                <button
                  type="button"
                  className={`bcf-mode-tab ${panelMode === "create" ? "is-active" : ""}`}
                  onClick={() => setPanelMode("create")}
                  disabled={!bcfProject}
                >
                  New topic
                </button>
              </div>

              <span className={`bcf-status-pill ${bcfDirty ? "is-dirty" : ""}`}>
                {busyLabel ?? (bcfDirty ? "Unsaved" : "Saved")}
              </span>

              <div className="bcf-menu" ref={menuRef}>
                <button
                  type="button"
                  className={`bcf-icon-button ${menuOpen ? "is-active" : ""}`}
                  aria-label="Open BCF actions"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  •••
                </button>
                {menuOpen ? (
                  <div className="bcf-menu__panel">
                    <button type="button" className="bcf-menu__item" onClick={handleCreateProject}>
                      New project
                    </button>
                    <button
                      type="button"
                      className="bcf-menu__item"
                      onClick={() => void handleExport()}
                      disabled={!bcfProject}
                    >
                      Export BCF
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="bcf-sidebar__section bcf-sidebar__section--grow">
            {panelMode === "browse" ? (
              <>
                <div className="bcf-list-heading">
                  <span>{topics.length} total</span>
                  <span>{openTopicCount} active</span>
                </div>

                <div className="bcf-topic-list">
                  {topics.length === 0 ? (
                    <div className="bcf-empty">No topics yet. Use the New topic tab to start a review.</div>
                  ) : (
                    topics.map((topic) => {
                      const metadata = parseTopicMetadata(topic);
                      const statusClass = isResolvedStatus(topic.topicStatus) ? "bcf-topic-card--resolved" : "bcf-topic-card--open";
                      return (
                        <button
                          key={topic.guid}
                          type="button"
                          className={`bcf-topic-card ${statusClass} ${topic.guid === selectedTopicGuid ? "is-active" : ""}`}
                          onClick={() => {
                            setSelectedTopicGuid(topic.guid);
                            setDetailTab("overview");
                          }}
                        >
                          <div className="bcf-topic-card__header">
                            <strong>{topic.title}</strong>
                            <span className="bcf-topic-card__badge">{topic.priority ?? "No priority"}</span>
                          </div>
                          <span>
                            {topic.topicStatus ?? "Open"} · {topic.topicType ?? "Issue"}
                          </span>
                          <span>
                            {topic.comments.length} comment{topic.comments.length === 1 ? "" : "s"} ·{" "}
                            {topic.viewpoints.length} view{topic.viewpoints.length === 1 ? "" : "s"}
                          </span>
                          <span>{metadata.activePath ?? "No IFC path recorded"}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </>
            ) : (
              <div className="bcf-create-panel">
                <div className="bcf-sidebar__label">Create a new issue</div>
                <TopicForm draft={createDraft} onChange={setCreateDraft} />
                <div className="bcf-create-panel__actions">
                  <button
                    type="button"
                    className="bcf-button bcf-button--accent"
                    onClick={handleCreateTopic}
                    disabled={!canCreateTopic}
                  >
                    Create topic
                  </button>
                  <button
                    type="button"
                    className="bcf-button"
                    onClick={() => {
                      setCreateDraft(EMPTY_DRAFT);
                      setPanelMode("browse");
                    }}
                  >
                    {createDraftDirty ? "Cancel" : "Back to topics"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>

        <section className="bcf-detail">
          {error ? <div className="viewer__message viewer__message--error">{error}</div> : null}

          {bcfProject ? (
            selectedTopic ? (
              <>
                <div className="bcf-detail__header">
                  <div>
                    <div className="bcf-sidebar__label">Selected topic</div>
                    <h3>{selectedTopic.title}</h3>
                    <p>
                      {selectedTopic.topicStatus ?? "Open"} · {selectedTopic.topicType ?? "Issue"} ·{" "}
                      {selectedTopic.priority ?? "No priority"}
                    </p>
                  </div>
                  <div className="bcf-detail__actions">
                    <button
                      type="button"
                      className="bcf-button"
                      onClick={() => {
                        setPanelMode("create");
                        setCreateDraft({
                          ...EMPTY_DRAFT,
                          labels: draft.labels,
                        });
                      }}
                    >
                      Clone into new
                    </button>
                    <button
                      type="button"
                      className="bcf-button"
                      onClick={() => void handleCaptureViewpoint()}
                      disabled={!viewerApi || !currentStore}
                    >
                      Capture viewpoint
                    </button>
                  </div>
                </div>

                <div className="bcf-detail-tabs" role="tablist" aria-label="Topic detail sections">
                  <button
                    type="button"
                    className={`bcf-detail-tab ${detailTab === "overview" ? "is-active" : ""}`}
                    onClick={() => setDetailTab("overview")}
                  >
                    Overview
                  </button>
                  <button
                    type="button"
                    className={`bcf-detail-tab ${detailTab === "edit" ? "is-active" : ""}`}
                    onClick={() => setDetailTab("edit")}
                  >
                    Edit
                    {selectedTopicDirty ? <span className="bcf-detail-tab__dot" aria-hidden="true" /> : null}
                  </button>
                  <button
                    type="button"
                    className={`bcf-detail-tab ${detailTab === "activity" ? "is-active" : ""}`}
                    onClick={() => setDetailTab("activity")}
                  >
                    Activity
                  </button>
                </div>

                {detailTab === "overview" ? (
                  <div className="bcf-detail-stack">
                    <div className="bcf-overview-grid">
                      <div className="bcf-meta-block">
                        <strong>Summary</strong>
                        <span>{stripTopicMetadata(selectedTopic.description) || "No description yet."}</span>
                      </div>
                      <div className="bcf-meta-block">
                        <strong>Model context</strong>
                        <span>
                          {selectedMetadata?.repoOwner && selectedMetadata.repoName
                            ? `${selectedMetadata.repoOwner}/${selectedMetadata.repoName}`
                            : "No repo metadata"}
                        </span>
                        <span>{selectedMetadata?.activePath ?? "No IFC path recorded"}</span>
                        <span>
                          {selectedMetadata?.activeSha
                            ? `Commit ${selectedMetadata.activeSha.slice(0, 7)}`
                            : "No commit recorded"}
                        </span>
                      </div>
                      <div className="bcf-meta-block">
                        <strong>Ownership</strong>
                        <span>{selectedTopic.assignedTo ?? "Unassigned"}</span>
                        <span>
                          {(selectedTopic.labels ?? []).length > 0
                            ? selectedTopic.labels?.join(", ")
                            : "No labels"}
                        </span>
                      </div>
                      <div className="bcf-meta-block">
                        <strong>Activity</strong>
                        <span>
                          {selectedTopic.comments.length} comment{selectedTopic.comments.length === 1 ? "" : "s"}
                        </span>
                        <span>
                          {selectedTopic.viewpoints.length} viewpoint
                          {selectedTopic.viewpoints.length === 1 ? "" : "s"}
                        </span>
                        <span>
                          Updated{" "}
                          {new Date(selectedTopic.modifiedDate ?? selectedTopic.creationDate).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : null}

                {detailTab === "edit" ? (
                  <div className="bcf-detail-stack">
                    <TopicForm draft={draft} onChange={setDraft} />
                    <div className="bcf-topic-actions">
                      <button type="button" className="bcf-button bcf-button--accent" onClick={handleSaveTopic}>
                        Save topic
                      </button>
                      <button
                        type="button"
                        className="bcf-button"
                        onClick={() => selectedTopic && setDraft(topicToDraft(selectedTopic))}
                        disabled={!selectedTopicDirty}
                      >
                        Reset changes
                      </button>
                    </div>
                  </div>
                ) : null}

                {detailTab === "activity" ? (
                  <div className="bcf-detail-stack">
                    <div className="bcf-viewpoints">
                      <div className="bcf-section-title">Viewpoints</div>
                      {selectedTopic.viewpoints.length === 0 ? (
                        <div className="bcf-empty">No viewpoints captured yet.</div>
                      ) : (
                        selectedTopic.viewpoints.map((viewpoint) => (
                          <button
                            key={viewpoint.guid}
                            type="button"
                            className={`bcf-viewpoint-card ${viewpoint.guid === selectedViewpoint?.guid ? "is-active" : ""}`}
                            onClick={() => void handleApplyViewpoint(viewpoint)}
                          >
                            <strong>{viewpoint.guid.slice(0, 8)}</strong>
                            <span>{viewpoint.snapshot ? "Snapshot attached" : "Camera-only viewpoint"}</span>
                          </button>
                        ))
                      )}
                    </div>

                    <div className="bcf-comments">
                      <div className="bcf-section-title">Comments</div>
                      {selectedTopic.comments.length === 0 ? (
                        <div className="bcf-empty">No comments yet.</div>
                      ) : (
                        selectedTopic.comments.map((comment) => (
                          <article key={comment.guid} className="bcf-comment">
                            <strong>{comment.author}</strong>
                            <span>{new Date(comment.date).toLocaleString()}</span>
                            <p>{comment.comment}</p>
                          </article>
                        ))
                      )}

                      <label className="field">
                        <span className="field__label">Add comment</span>
                        <textarea
                          rows={4}
                          value={commentDraft}
                          onChange={(event) => setCommentDraft(event.target.value)}
                          placeholder="Document the decision, missing information, or next action."
                        />
                      </label>
                      <button type="button" className="bcf-button" onClick={handleAddComment}>
                        Add comment
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="bcf-empty bcf-empty--standalone">
                Select a topic from the list to review its details, or create a new one from the New topic tab.
              </div>
            )
          ) : (
            <div className="bcf-empty bcf-empty--standalone">
              {repoBcfFiles.length > 0
                ? "Select a repository BCF file to inspect its issues."
                : "Add a .bcf or .bcfzip file to the repo to inspect issues here."}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function TopicForm({
  draft,
  onChange,
}: {
  draft: BcfPanelTopicDraft;
  onChange: Dispatch<SetStateAction<BcfPanelTopicDraft>>;
}) {
  return (
    <div className="bcf-fields">
      <label className="field">
        <span className="field__label">Title</span>
        <input
          value={draft.title}
          onChange={(event) => onChange((state) => ({ ...state, title: event.target.value }))}
          placeholder="Describe the issue clearly"
        />
      </label>

      <label className="field">
        <span className="field__label">Description</span>
        <textarea
          rows={5}
          value={draft.description}
          onChange={(event) => onChange((state) => ({ ...state, description: event.target.value }))}
          placeholder="What is wrong, where is it, and what should happen next?"
        />
      </label>

      <div className="bcf-inline-grid">
        <SelectField
          label="Status"
          value={draft.topicStatus}
          options={TOPIC_STATUS_OPTIONS}
          onChange={(value) => onChange((state) => ({ ...state, topicStatus: value }))}
        />
        <SelectField
          label="Type"
          value={draft.topicType}
          options={TOPIC_TYPE_OPTIONS}
          onChange={(value) => onChange((state) => ({ ...state, topicType: value }))}
        />
        <SelectField
          label="Priority"
          value={draft.priority}
          options={PRIORITY_OPTIONS}
          onChange={(value) => onChange((state) => ({ ...state, priority: value }))}
        />
        <label className="field">
          <span className="field__label">Assigned to</span>
          <input
            value={draft.assignedTo}
            onChange={(event) => onChange((state) => ({ ...state, assignedTo: event.target.value }))}
            placeholder="Reviewer or discipline lead"
          />
        </label>
      </div>

      <label className="field">
        <span className="field__label">Labels</span>
        <input
          value={draft.labels}
          onChange={(event) => onChange((state) => ({ ...state, labels: event.target.value }))}
          placeholder="coordination, clash, structure"
        />
      </label>
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function topicToDraft(topic: BCFTopic): BcfPanelTopicDraft {
  return {
    title: topic.title,
    description: stripTopicMetadata(topic.description),
    topicStatus: topic.topicStatus ?? "Open",
    topicType: topic.topicType ?? "Issue",
    priority: topic.priority ?? "Medium",
    assignedTo: topic.assignedTo ?? "",
    labels: topic.labels?.join(", ") ?? "",
  };
}

function parseLabels(labels: string) {
  return labels
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}

function isSameDraft(left: BcfPanelTopicDraft, right: BcfPanelTopicDraft) {
  return (
    left.title === right.title &&
    left.description === right.description &&
    left.topicStatus === right.topicStatus &&
    left.topicType === right.topicType &&
    left.priority === right.priority &&
    left.assignedTo === right.assignedTo &&
    left.labels === right.labels
  );
}

function mapIdsToGuids(store: NonNullable<ReturnType<typeof useAppStore.getState>["currentStore"]>, ids: number[]) {
  return ids
    .map((expressId) => getGuidForExpressId(store, expressId))
    .filter((guid): guid is string => typeof guid === "string");
}
