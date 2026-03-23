import { useEffect, useMemo, useState } from "react";

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
  parseTopicMetadata,
  readViewpointState,
  stripTopicMetadata,
  updateTopic,
  withTopicMetadata,
  appendComment,
  appendViewpoint,
  mapGuidsToExpressIds,
} from "../../lib/bcf";
import { fetchRepoFileBuffer } from "../../lib/github";
import { useAppStore } from "../../store/useAppStore";
import type { BCFViewpoint, BcfPanelTopicDraft } from "../../types/bcf";

const DEFAULT_AUTHOR = "reviewer@hackporto.local";

const EMPTY_DRAFT: BcfPanelTopicDraft = {
  title: "",
  description: "",
  topicStatus: "Open",
  topicType: "Issue",
  priority: "Medium",
  assignedTo: "",
  labels: "",
};

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

  const [draft, setDraft] = useState<BcfPanelTopicDraft>(EMPTY_DRAFT);
  const [newTopicTitle, setNewTopicTitle] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [selectedRepoBcfPath, setSelectedRepoBcfPath] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const repoBcfFiles = useMemo(
    () => availableBcfFiles.slice().sort((left, right) => right.path.localeCompare(left.path)),
    [availableBcfFiles],
  );
  const topics = useMemo(() => listTopics(bcfProject), [bcfProject]);
  const selectedTopic = selectedTopicGuid ? bcfProject?.topics.get(selectedTopicGuid) ?? null : null;
  const selectedMetadata = useMemo(
    () => (selectedTopic ? parseTopicMetadata(selectedTopic) : null),
    [selectedTopic],
  );
  const selectedViewpoint =
    selectedTopic?.viewpoints.find((viewpoint) => viewpoint.guid === selectedViewpointGuid) ?? null;

  useEffect(() => {
    if (!selectedTopic) {
      setDraft(EMPTY_DRAFT);
      return;
    }

    setDraft({
      title: selectedTopic.title,
      description: stripTopicMetadata(selectedTopic.description),
      topicStatus: selectedTopic.topicStatus ?? "Open",
      topicType: selectedTopic.topicType ?? "Issue",
      priority: selectedTopic.priority ?? "Medium",
      assignedTo: selectedTopic.assignedTo ?? "",
      labels: selectedTopic.labels?.join(", ") ?? "",
    });
  }, [selectedTopic]);

  useEffect(() => {
    if (repoBcfFiles.length === 0) {
      setSelectedRepoBcfPath(null);
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
    const selectedRepoBcfShaRef = selectedRepoBcfFile.sha;
    let cancelled = false;

    async function loadRepoBcf() {
      setBusyLabel("Loading BCF from GitHub");
      setError(null);

      try {
        const buffer = await fetchRepoFileBuffer(
          repoRef,
          selectedRepoBcfShaRef,
          selectedRepoBcfPathRef,
          authToken,
        );
        const project = await importBcfProject(buffer);
        if (cancelled) {
          return;
        }

        setBcfProject(project, selectedRepoBcfPathRef);
      } catch (caughtError) {
        if (cancelled) {
          return;
        }

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
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to export BCF.");
    } finally {
      setBusyLabel(null);
    }
  };

  const handleCreateProject = () => {
    const projectName = repo ? `${repo.owner}/${repo.name} review` : "HackPorto Review";
    setBcfProject(createEmptyBcfProject(projectName), "review.bcfzip");
    setError(null);
  };

  const handleCreateTopic = () => {
    const trimmedTitle = newTopicTitle.trim();
    if (!trimmedTitle || !bcfProject) {
      return;
    }

    const topic = createTopicForCurrentModel({
      title: trimmedTitle,
      author: DEFAULT_AUTHOR,
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
    setNewTopicTitle("");
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
        labels: draft.labels
          .split(",")
          .map((label) => label.trim())
          .filter(Boolean),
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
          ? `${topics.length} topic${topics.length === 1 ? "" : "s"}${bcfDirty ? " · unsaved changes" : ""}`
          : "Loading BCF issues from GitHub."}
      </div>

      <div className="bcf-toolbar">
        <button type="button" className="bcf-button" onClick={handleCreateProject}>
          New project
        </button>
        <button type="button" className="bcf-button bcf-button--accent" onClick={() => void handleExport()} disabled={!bcfProject}>
          Export
        </button>
      </div>

      <div className="bcf-project-meta">
        <span>{bcfSourceName ?? "No BCF loaded from repo"}</span>
        <span>{busyLabel ?? (bcfDirty ? "Dirty" : "Saved")}</span>
      </div>

      {error ? <div className="viewer__message viewer__message--error">{error}</div> : null}

      {repoBcfFiles.length > 0 ? (
        <div className="bcf-repo-files">
          {repoBcfFiles.map((file) => (
            <button
              key={`${file.branch}:${file.path}`}
              type="button"
              className={`bcf-repo-file ${file.path === selectedRepoBcfPath ? "is-active" : ""}`}
              onClick={() => setSelectedRepoBcfPath(file.path)}
              title={`${file.branch} @ ${file.sha.slice(0, 7)}`}
            >
              {file.path}
            </button>
          ))}
        </div>
      ) : null}

      {bcfProject ? (
        <div className="bcf-layout">
          <section className="bcf-column">
            <div className="bcf-create-row">
              <input
                value={newTopicTitle}
                onChange={(event) => setNewTopicTitle(event.target.value)}
                placeholder="Create a new issue topic"
              />
              <button type="button" className="bcf-button" onClick={handleCreateTopic}>
                Add
              </button>
            </div>

            <div className="bcf-topic-list">
              {topics.map((topic) => (
                <button
                  key={topic.guid}
                  type="button"
                  className={`bcf-topic-card ${topic.guid === selectedTopicGuid ? "is-active" : ""}`}
                  onClick={() => setSelectedTopicGuid(topic.guid)}
                >
                  <strong>{topic.title}</strong>
                  <span>
                    {topic.topicStatus ?? "Open"} · {topic.priority ?? "No priority"}
                  </span>
                  <span>
                    {topic.comments.length} comment{topic.comments.length === 1 ? "" : "s"} ·{" "}
                    {topic.viewpoints.length} view{topic.viewpoints.length === 1 ? "" : "s"}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="bcf-column bcf-column--detail">
            {selectedTopic ? (
              <>
                <div className="bcf-fields">
                  <label className="field">
                    <span className="field__label">Title</span>
                    <input value={draft.title} onChange={(event) => setDraft((state) => ({ ...state, title: event.target.value }))} />
                  </label>

                  <label className="field">
                    <span className="field__label">Description</span>
                    <textarea
                      rows={5}
                      value={draft.description}
                      onChange={(event) => setDraft((state) => ({ ...state, description: event.target.value }))}
                    />
                  </label>

                  <div className="bcf-inline-grid">
                    <label className="field">
                      <span className="field__label">Status</span>
                      <input
                        value={draft.topicStatus}
                        onChange={(event) => setDraft((state) => ({ ...state, topicStatus: event.target.value }))}
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">Type</span>
                      <input
                        value={draft.topicType}
                        onChange={(event) => setDraft((state) => ({ ...state, topicType: event.target.value }))}
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">Priority</span>
                      <input
                        value={draft.priority}
                        onChange={(event) => setDraft((state) => ({ ...state, priority: event.target.value }))}
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">Assigned to</span>
                      <input
                        value={draft.assignedTo}
                        onChange={(event) => setDraft((state) => ({ ...state, assignedTo: event.target.value }))}
                      />
                    </label>
                  </div>

                  <label className="field">
                    <span className="field__label">Labels</span>
                    <input
                      value={draft.labels}
                      onChange={(event) => setDraft((state) => ({ ...state, labels: event.target.value }))}
                      placeholder="coordination, clash, review"
                    />
                  </label>
                </div>

                <div className="bcf-topic-actions">
                  <button type="button" className="bcf-button bcf-button--accent" onClick={handleSaveTopic}>
                    Save topic
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

                <div className="bcf-meta-block">
                  <strong>Model context</strong>
                  <span>{selectedMetadata?.repoOwner && selectedMetadata.repoName ? `${selectedMetadata.repoOwner}/${selectedMetadata.repoName}` : "No repo metadata"}</span>
                  <span>{selectedMetadata?.activePath ?? "No IFC path recorded"}</span>
                  <span>{selectedMetadata?.activeSha ? `Commit ${selectedMetadata.activeSha.slice(0, 7)}` : "No commit recorded"}</span>
                </div>

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
                      rows={3}
                      value={commentDraft}
                      onChange={(event) => setCommentDraft(event.target.value)}
                    />
                  </label>
                  <button type="button" className="bcf-button" onClick={handleAddComment}>
                    Add comment
                  </button>
                </div>
              </>
            ) : (
              <div className="bcf-empty">Create or select a topic to start reviewing this model.</div>
            )}
          </section>
        </div>
      ) : (
        <div className="bcf-empty bcf-empty--standalone">
          {repoBcfFiles.length > 0
            ? "Select a repository BCF file to inspect its issues."
            : "Add a .bcf or .bcfzip file to the repo to inspect issues here."}
        </div>
      )}
    </div>
  );
}

function mapIdsToGuids(store: NonNullable<ReturnType<typeof useAppStore.getState>["currentStore"]>, ids: number[]) {
  return ids
    .map((expressId) => getGuidForExpressId(store, expressId))
    .filter((guid): guid is string => typeof guid === "string");
}
