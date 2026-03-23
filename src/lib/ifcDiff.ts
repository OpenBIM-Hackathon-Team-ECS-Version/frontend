import { extractEntityAttributesOnDemand, type IfcDataStore } from "@ifc-lite/parser";

export function mapGuidsToExpressIds(store: IfcDataStore, guids: Iterable<string>) {
  const guidLookup = new Map<string, number>();

  store.entityIndex.byId.forEach((_, expressId) => {
    const attributes = extractEntityAttributesOnDemand(store, expressId);
    if (attributes.globalId) {
      guidLookup.set(attributes.globalId, expressId);
    }
  });

  return Array.from(guids)
    .map((guid) => guidLookup.get(guid))
    .filter((expressId): expressId is number => typeof expressId === "number");
}
