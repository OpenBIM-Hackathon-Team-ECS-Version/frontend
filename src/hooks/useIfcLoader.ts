import { useEffect, useRef } from "react";

import { fetchIfcBuffer } from "../lib/github";
import { useAppStore } from "../store/useAppStore";

export function useIfcLoader(
  loadIfc: (buffer: ArrayBuffer, requestKey: string) => Promise<unknown>,
  loadIfcPathsForSha: (sha: string) => Promise<string[]>,
) {
  const repo = useAppStore((state) => state.repo);
  const authToken = useAppStore((state) => state.authToken);
  const activeSha = useAppStore((state) => state.activeSha);
  const activePath = useAppStore((state) => state.activePath);
  const setLoadState = useAppStore((state) => state.setLoadState);
  const setSelectedFilePath = useAppStore((state) => state.setSelectedFilePath);

  const lastRequestKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!repo || !activeSha) {
      return;
    }

    const repoRef = repo;
    const sha = activeSha;
    let cancelled = false;

    async function run() {
      try {
        const availablePaths = await loadIfcPathsForSha(sha);
        if (cancelled) {
          return;
        }

        const trackedPath = activePath ?? null;
        const resolvedPath =
          trackedPath && availablePaths.includes(trackedPath)
            ? trackedPath
            : trackedPath
              ? availablePaths[0] ?? null
              : availablePaths[0] ?? null;

        if (!resolvedPath) {
          setLoadState({
            loading: false,
            loadError: trackedPath
              ? `Tracked IFC file is not present in commit ${sha.slice(0, 7)}.`
              : "No .ifc files were found in this commit.",
            loadProgress: 0,
          });
          lastRequestKeyRef.current = null;
          return;
        }

        if (resolvedPath !== trackedPath) {
          setSelectedFilePath(resolvedPath);
        }

        const requestKey = `${repoRef.owner}/${repoRef.name}:${sha}:${resolvedPath}`;
        if (lastRequestKeyRef.current === requestKey) {
          return;
        }
        lastRequestKeyRef.current = requestKey;

        const buffer = await fetchIfcBuffer(repoRef, sha, resolvedPath, authToken);
        if (cancelled) {
          return;
        }

        await loadIfc(buffer, requestKey);
      } catch (caughtError) {
        const message =
          caughtError instanceof Error ? caughtError.message : "Failed to fetch the IFC file.";

        setLoadState({
          loading: false,
          loadError: message,
        });
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    activePath,
    activeSha,
    authToken,
    loadIfc,
    loadIfcPathsForSha,
    repo,
    setSelectedFilePath,
    setLoadState,
  ]);
}
