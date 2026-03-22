import { useEffect } from "react";

import { getFileCommitHistory } from "../lib/github";
import { getIfcDiff } from "../lib/api";
import { useAppStore } from "../store/useAppStore";
import type { IfcDiffResult } from "../types/ifc";

export function useIfcDiff(
  applyDiff: (diff: IfcDiffResult | null) => void,
  enabled = true,
) {
  const repo = useAppStore((state) => state.repo);
  const authToken = useAppStore((state) => state.authToken);
  const activeSha = useAppStore((state) => state.activeSha);
  const activePath = useAppStore((state) => state.activePath);
  const currentStore = useAppStore((state) => state.currentStore);
  const setDiffResult = useAppStore((state) => state.setDiffResult);

  useEffect(() => {
    if (!enabled || !currentStore || !repo || !activeSha || !activePath) {
      setDiffResult(null);
      applyDiff(null);
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
          applyDiff(null);
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
        applyDiff(diff);
      } catch (caughtError) {
        if (cancelled) {
          return;
        }

        console.error(caughtError);
        setDiffResult(null);
        applyDiff(null);
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
