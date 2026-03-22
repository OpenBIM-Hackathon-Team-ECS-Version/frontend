export interface IfcDiffResult {
  added: Set<string>;
  removed: Set<string>;
  changed: Set<string>;
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
