import {
  extractAllEntityAttributes,
  extractEntityAttributesOnDemand,
  type IfcDataStore,
} from "@ifc-lite/parser";

import type { IfcDiffResult } from "../types/ifc";

const TRACKED_TYPES = [
  "IfcWall",
  "IfcSlab",
  "IfcColumn", 
  "IfcBeam",
  "IfcDoor",
  "IfcWindow",
  "IfcSpace",
];

interface IfcFingerprint {
  globalId: string;
  expressId: number;
  signature: string;
}

function createFingerprint(store: IfcDataStore, expressId: number): IfcFingerprint | null {
  const entityRef = store.entityIndex.byId.get(expressId);
  if (!entityRef) {
    return null;
  }

  const core = extractEntityAttributesOnDemand(store, expressId);
  if (!core.globalId) {
    return null;
  }

  const attributes = extractAllEntityAttributes(store, expressId);
  const signature = JSON.stringify({
    type: entityRef.type,
    core,
    attributes,
  });

  return {
    globalId: core.globalId,
    expressId,
    signature,
  };
}

function collectFingerprints(store: IfcDataStore) {
  const entries = new Map<string, IfcFingerprint>();

  TRACKED_TYPES.forEach((type) => {
    const expressIds = store.entityIndex.byType.get(type) ?? [];

    expressIds.forEach((expressId) => {
      const fingerprint = createFingerprint(store, expressId);
      if (fingerprint) {
        entries.set(fingerprint.globalId, fingerprint);
      }
    });
  });

  return entries;
}

function difference(left: Set<string>, right: Set<string>) {
  const result = new Set<string>();
  left.forEach((value) => {
    if (!right.has(value)) {
      result.add(value);
    }
  });
  return result;
}

export function diffDataStores(prev: IfcDataStore, next: IfcDataStore): IfcDiffResult {
  const prevFingerprints = collectFingerprints(prev);
  const nextFingerprints = collectFingerprints(next);

  const prevGuids = new Set(prevFingerprints.keys());
  const nextGuids = new Set(nextFingerprints.keys());
  const changed = new Set<string>();

  nextGuids.forEach((guid) => {
    const prevEntry = prevFingerprints.get(guid);
    const nextEntry = nextFingerprints.get(guid);
    if (prevEntry && nextEntry && prevEntry.signature !== nextEntry.signature) {
      changed.add(guid);
    }
  });

  return {
    added: difference(nextGuids, prevGuids),
    removed: difference(prevGuids, nextGuids),
    changed,
  };
}

export function mapGuidsToExpressIds(store: IfcDataStore, guids: Iterable<string>) {
  const guidLookup = new Map<string, number>();

  TRACKED_TYPES.forEach((type) => {
    const expressIds = store.entityIndex.byType.get(type) ?? [];
    expressIds.forEach((expressId) => {
      const attributes = extractEntityAttributesOnDemand(store, expressId);
      if (attributes.globalId) {
        guidLookup.set(attributes.globalId, expressId);
      }
    });
  });

  return Array.from(guids)
    .map((guid) => guidLookup.get(guid))
    .filter((expressId): expressId is number => typeof expressId === "number");
}
