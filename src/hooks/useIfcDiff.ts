import { useEffect } from "react";

import { getFileCommitHistory } from "../lib/github";
import { getGitHubComponentDetails, getIfcDiff } from "../lib/api";
import { useAppStore } from "../store/useAppStore";
import type { IfcDiffDetail, IfcDiffResult } from "../types/ifc";

export function useIfcDiff(
  applyDiff: (diff: IfcDiffResult | null, ghostNonAffected: boolean) => void,
  enabled = true,
) {
  const repo = useAppStore((state) => state.repo);
  const authToken = useAppStore((state) => state.authToken);
  const activeSha = useAppStore((state) => state.activeSha);
  const activePath = useAppStore((state) => state.activePath);
  const currentStore = useAppStore((state) => state.currentStore);
  const diffHighlightEnabled = useAppStore((state) => state.diffHighlightEnabled);
  const diffGhostNonAffectedEnabled = useAppStore((state) => state.diffGhostNonAffectedEnabled);
  const diffResult = useAppStore((state) => state.diffResult);
  const setDiffResult = useAppStore((state) => state.setDiffResult);

  useEffect(() => {
    if (!enabled || !currentStore) {
      applyDiff(null, false);
      return;
    }

    applyDiff(diffHighlightEnabled ? diffResult : null, diffGhostNonAffectedEnabled);
  }, [applyDiff, currentStore, diffGhostNonAffectedEnabled, diffHighlightEnabled, diffResult, enabled]);

  useEffect(() => {
    if (!enabled || !currentStore || !repo || !activeSha || !activePath) {
      setDiffResult(null);
      applyDiff(null, false);
      return;
    }

    const resolvedRepo = repo;
    const resolvedActiveSha = activeSha;
    const resolvedActivePath = activePath;
    let cancelled = false;

    async function loadDiff() {
      try {
        const fileHistory = await getFileCommitHistory(
          resolvedRepo,
          resolvedActiveSha,
          resolvedActivePath,
          authToken,
        );
        const previousRevisionSha = fileHistory[1]?.sha ?? null;

        if (!previousRevisionSha) {
          if (cancelled) {
            return;
          }

          setDiffResult(null);
          applyDiff(null, false);
          return;
        }

        const diff = await getIfcDiff({
          repo: resolvedRepo,
          currentSha: resolvedActiveSha,
          lastSha: previousRevisionSha,
          filePath: resolvedActivePath,
          githubToken: authToken,
        });

        if (cancelled) {
          return;
        }

        setDiffResult(diff);

        const currentGuids = Array.from(new Set([...diff.added, ...diff.changed]));
        const deletedGuids = Array.from(diff.deleted);
        const emptyDetailMap: Record<string, IfcDiffDetail> = {};

        try {
          const [currentDetails, deletedDetails] = await Promise.all([
            currentGuids.length > 0
              ? getGitHubComponentDetails(
                  resolvedRepo,
                  resolvedActiveSha,
                  resolvedActivePath,
                  currentGuids,
                  authToken,
                )
              : Promise.resolve(emptyDetailMap),
            deletedGuids.length > 0
              ? getGitHubComponentDetails(
                  resolvedRepo,
                  previousRevisionSha,
                  resolvedActivePath,
                  deletedGuids,
                  authToken,
                )
              : Promise.resolve(emptyDetailMap),
          ]);

          if (cancelled) {
            return;
          }

          const detailsById = { ...diff.detailsById };
          [currentDetails, deletedDetails].forEach((detailMap) => {
            Object.entries(detailMap).forEach(([globalId, detail]) => {
              detailsById[globalId] = {
                ...detail,
                ...(detailsById[globalId] ?? {}),
                name: detail.name,
                description: detail.description,
                objectType: detail.objectType,
                tag: detail.tag,
                type: detail.type,
              };
            });
          });

          setDiffResult({
            ...diff,
            detailsById,
          });
        } catch (detailError) {
          if (!cancelled) {
            console.warn("Component detail enrichment failed; keeping base IFC diff.", detailError);
          }
        }
      } catch (caughtError) {
        if (cancelled) {
          return;
        }

        console.error(caughtError);
        setDiffResult(null);
        applyDiff(null, false);
      }
    }

    void loadDiff();

    return () => {
      cancelled = true;
    };
  }, [
    activePath,
    activeSha,
    applyDiff,
    authToken,
    currentStore,
    enabled,
    repo,
    setDiffResult,
  ]);
}
