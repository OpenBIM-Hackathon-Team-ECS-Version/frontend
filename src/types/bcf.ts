import type {
  BCFMarker3D,
  BCFComment,
  BCFOverlayProjection,
  BCFOverlayRendererOptions,
  BCFProject,
  BCFTopic,
  BCFViewpoint,
  ViewerBounds,
  ViewerCameraState,
  ViewerSectionPlane,
} from "@ifc-lite/bcf";

export type { BCFComment, BCFProject, BCFTopic, BCFViewpoint, ViewerBounds, ViewerCameraState, ViewerSectionPlane };
export type { BCFMarker3D, BCFOverlayProjection, BCFOverlayRendererOptions };

export interface BcfTopicMetadata {
  repoName: string | null;
  repoOwner: string | null;
  activePath: string | null;
  activeSha: string | null;
  createdSha?: string | null;
}

export interface BcfViewpointCaptureInput {
  camera: ViewerCameraState;
  bounds?: ViewerBounds;
  sectionPlane?: ViewerSectionPlane | null;
  selectedGuids: string[];
  hiddenGuids: string[];
  visibleGuids: string[];
  coloredGuids: Array<{
    color: string;
    guids: string[];
  }>;
  snapshot?: string | null;
}

export interface BcfViewpointState {
  camera?: ViewerCameraState;
  sectionPlane?: ViewerSectionPlane;
  selectedGuids: string[];
  hiddenGuids: string[];
  visibleGuids: string[];
  coloredGuids: Array<{
    color: string;
    guids: string[];
  }>;
}

export interface BcfViewerBridge {
  captureSnapshot: () => Promise<string | null>;
  getCameraState: () => ViewerCameraState | null;
  getBounds: () => ViewerBounds | null;
  applyCameraState: (camera: ViewerCameraState) => void;
  frameExpressId: (expressId: number) => Promise<void>;
  requestRender: () => void;
}

export interface BcfPanelTopicDraft {
  title: string;
  description: string;
  topicStatus: string;
  topicType: string;
  priority: string;
  assignedTo: string;
  labels: string;
}
