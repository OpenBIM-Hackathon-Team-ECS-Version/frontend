import { extractEntityAttributesOnDemand, type IfcDataStore } from "@ifc-lite/parser";

const TRACKED_TYPES = [
  "IfcWall",
  "IfcSlab",
  "IfcColumn", 
  "IfcBeam",
  "IfcDoor",
  "IfcWindow",
  "IfcSpace",
];

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
