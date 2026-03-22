import { useEffect } from "react";

import { diffDataStores } from "../lib/ifcDiff";
import { useAppStore } from "../store/useAppStore";
import type { IfcDiffResult } from "../types/ifc";

export function useIfcDiff(
  applyDiff: (diff: IfcDiffResult | null) => void,
  enabled = true,
) {
  const currentStore = useAppStore((state) => state.currentStore);
  const previousStore = useAppStore((state) => state.previousStore);
  const setDiffResult = useAppStore((state) => state.setDiffResult);

  useEffect(() => {
    if (!enabled || !currentStore) {
      setDiffResult(null);
      applyDiff(null);
      return;
    }

    if (!previousStore) {
      setDiffResult(null);
      applyDiff(null);
      return;
    }

    const diff = diffDataStores(previousStore, currentStore);
    setDiffResult(diff);
    applyDiff(diff);
  }, [applyDiff, currentStore, enabled, previousStore, setDiffResult]);
}
