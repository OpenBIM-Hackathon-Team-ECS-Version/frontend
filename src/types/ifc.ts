export interface IfcDiffResult {
  baseSha: string;
  compareSha: string;
  added: Set<string>;
  deleted: Set<string>;
  changed: Set<string>;
  changesById: Record<string, { type: string; fields: string[] }>;
  detailsById: Record<string, IfcDiffDetail>;
}

export interface IfcDiffDetail {
  globalId: string;
  status: "added" | "changed" | "deleted";
  type: string;
  previousType?: string | null;
  name: string | null;
  description: string | null;
  objectType: string | null;
  tag: string | null;
  changedFields: string[];
}

export interface BackendVersion {
  versionId: string;
  shortId: string;
  message: string;
  timestamp: string;
  author: string;
}

export interface QueryComponentRecord {
  componentGuid: string;
  componentType?: string;
  entityGuid?: string;
  entityType?: string;
  _model?: string;
  [key: string]: unknown;
}

export interface QueryExplorerFilters {
  type: string | null;
}

export interface IfcPropertyItem {
  name: string;
  value: string;
}

export interface IfcPropertyGroup {
  name: string;
  entries: IfcPropertyItem[];
}

export interface SelectedIfcEntity {
  expressId: number;
  type: string;
  globalId: string | null;
  name: string | null;
  description: string | null;
  objectType: string | null;
  tag: string | null;
  attributes: IfcPropertyItem[];
  propertySets: IfcPropertyGroup[];
  quantitySets: IfcPropertyGroup[];
}

export interface ViewerStatus {
  webGpuSupported: boolean;
  viewerReady: boolean;
  loading: boolean;
  loadProgress: number;
  loadError: string | null;
  entityCount: number;
}
