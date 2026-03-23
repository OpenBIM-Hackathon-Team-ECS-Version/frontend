import {
  addCommentToTopic,
  addTopicToProject,
  addViewpointToTopic,
  createBCFComment,
  createBCFProject,
  createBCFTopic,
  createViewpoint,
  extractViewpointState,
  parseARGBColor,
  readBCF,
  toARGBColor,
  writeBCF,
} from "@ifc-lite/bcf";
import { extractEntityAttributesOnDemand, type IfcDataStore } from "@ifc-lite/parser";

import type {
  BCFComment,
  BCFProject,
  BCFTopic,
  BCFViewpoint,
  BcfTopicMetadata,
  BcfViewpointCaptureInput,
  BcfViewpointState,
} from "../types/bcf";

const TOPIC_META_PREFIX = "[ifc-git-viewer]";

export function createEmptyBcfProject(name = "HackPorto Review") {
  return createBCFProject({
    name,
    version: "3.0",
  });
}

export async function importBcfProject(buffer: ArrayBuffer) {
  try {
    return await readBCF(buffer);
  } catch (error) {
    const text = tryDecodeText(buffer);
    if (!text || !looksLikePlainBcfMarkup(text)) {
      throw error;
    }

    return readPlainBcfMarkup(text);
  }
}

export async function exportBcfProject(project: BCFProject) {
  return writeBCF(project);
}

export function createTopicForCurrentModel(params: {
  title: string;
  description?: string;
  author: string;
  topicStatus?: string;
  topicType?: string;
  priority?: string;
  assignedTo?: string;
  labels?: string[];
  metadata: BcfTopicMetadata;
}) {
  const topic = createBCFTopic({
    title: params.title,
    description: withTopicMetadata(params.description, params.metadata),
    author: params.author,
    topicStatus: params.topicStatus || undefined,
    topicType: params.topicType || undefined,
    priority: params.priority || undefined,
    assignedTo: params.assignedTo || undefined,
    labels: params.labels?.filter(Boolean),
  });

  return topic;
}

export function addTopic(project: BCFProject, topic: BCFTopic) {
  addTopicToProject(project, topic);
  return project;
}

export function appendComment(topic: BCFTopic, params: { author: string; comment: string; viewpointGuid?: string }) {
  const comment = createBCFComment(params);
  addCommentToTopic(topic, comment);
  return comment;
}

export function appendViewpoint(topic: BCFTopic, capture: BcfViewpointCaptureInput) {
  const viewpoint = createViewpoint({
    camera: capture.camera,
    bounds: capture.bounds,
    sectionPlane: capture.sectionPlane ?? undefined,
    snapshot: capture.snapshot ?? undefined,
    selectedGuids: capture.selectedGuids,
    hiddenGuids: capture.hiddenGuids,
    visibleGuids: capture.visibleGuids,
    coloredGuids: capture.coloredGuids,
  });

  addViewpointToTopic(topic, viewpoint);
  return viewpoint;
}

export function readViewpointState(viewpoint: BCFViewpoint, bounds?: BcfViewpointCaptureInput["bounds"]): BcfViewpointState {
  return extractViewpointState(viewpoint, bounds);
}

export function cloneProject(project: BCFProject): BCFProject {
  const topics = new Map<string, BCFTopic>();

  project.topics.forEach((topic, guid) => {
    topics.set(guid, {
      ...topic,
      labels: topic.labels ? [...topic.labels] : undefined,
      comments: topic.comments.map((comment) => ({ ...comment })),
      viewpoints: topic.viewpoints.map((viewpoint) => ({
        ...viewpoint,
        lines: viewpoint.lines ? viewpoint.lines.map((line) => ({ ...line })) : undefined,
        clippingPlanes: viewpoint.clippingPlanes
          ? viewpoint.clippingPlanes.map((plane) => ({ ...plane }))
          : undefined,
        bitmaps: viewpoint.bitmaps ? viewpoint.bitmaps.map((bitmap) => ({ ...bitmap })) : undefined,
        components: viewpoint.components
          ? {
              ...viewpoint.components,
              selection: viewpoint.components.selection
                ? viewpoint.components.selection.map((component) => ({ ...component }))
                : undefined,
              visibility: viewpoint.components.visibility
                ? {
                    ...viewpoint.components.visibility,
                    exceptions: viewpoint.components.visibility.exceptions
                      ? viewpoint.components.visibility.exceptions.map((component) => ({ ...component }))
                      : undefined,
                    viewSetupHints: viewpoint.components.visibility.viewSetupHints
                      ? { ...viewpoint.components.visibility.viewSetupHints }
                      : undefined,
                  }
                : undefined,
              coloring: viewpoint.components.coloring
                ? viewpoint.components.coloring.map((coloring) => ({
                    ...coloring,
                    components: coloring.components.map((component) => ({ ...component })),
                  }))
                : undefined,
            }
          : undefined,
      })),
      documentReferences: topic.documentReferences
        ? topic.documentReferences.map((reference) => ({ ...reference }))
        : undefined,
      relatedTopics: topic.relatedTopics ? [...topic.relatedTopics] : undefined,
      bimSnippet: topic.bimSnippet ? { ...topic.bimSnippet } : undefined,
    });
  });

  return {
    ...project,
    extensions: project.extensions
      ? {
          topicLabels: project.extensions.topicLabels ? [...project.extensions.topicLabels] : undefined,
          topicStatuses: project.extensions.topicStatuses ? [...project.extensions.topicStatuses] : undefined,
          topicTypes: project.extensions.topicTypes ? [...project.extensions.topicTypes] : undefined,
          priorities: project.extensions.priorities ? [...project.extensions.priorities] : undefined,
          users: project.extensions.users ? [...project.extensions.users] : undefined,
          stages: project.extensions.stages ? [...project.extensions.stages] : undefined,
        }
      : undefined,
    topics,
  };
}

export function updateTopic(topic: BCFTopic, next: Partial<BCFTopic>) {
  Object.assign(topic, next);
  return topic;
}

export function colorOverridesFromGuids(
  store: IfcDataStore,
  coloredGuids: Array<{
    color: string;
    guids: string[];
  }>,
) {
  const overrides = new Map<number, [number, number, number, number]>();

  for (const entry of coloredGuids) {
    const { r, g, b, a } = parseARGBColor(entry.color);
    const rgba: [number, number, number, number] = [r / 255, g / 255, b / 255, a / 255];
    mapGuidsToExpressIds(store, entry.guids).forEach((expressId) => {
      overrides.set(expressId, rgba);
    });
  }

  return overrides;
}

export function colorOverridesToGuids(
  store: IfcDataStore,
  overrides: Map<number, [number, number, number, number]>,
) {
  const grouped = new Map<string, string[]>();

  overrides.forEach((rgba, expressId) => {
    const guid = getGuidForExpressId(store, expressId);
    if (!guid) {
      return;
    }

    const color = toARGBColor(
      Math.round(rgba[0] * 255),
      Math.round(rgba[1] * 255),
      Math.round(rgba[2] * 255),
      Math.round((rgba[3] ?? 1) * 255),
    );

    const guids = grouped.get(color) ?? [];
    guids.push(guid);
    grouped.set(color, guids);
  });

  return Array.from(grouped.entries()).map(([color, guids]) => ({ color, guids }));
}

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

export function getGuidForExpressId(store: IfcDataStore, expressId: number) {
  const attributes = extractEntityAttributesOnDemand(store, expressId);
  return attributes.globalId || null;
}

export function listTopics(project: BCFProject | null) {
  if (!project) {
    return [];
  }

  return Array.from(project.topics.values()).sort((left, right) => {
    const leftDate = left.modifiedDate ?? left.creationDate;
    const rightDate = right.modifiedDate ?? right.creationDate;
    return rightDate.localeCompare(leftDate);
  });
}

export function parseTopicMetadata(topic: BCFTopic): BcfTopicMetadata {
  const description = topic.description ?? "";
  const markerIndex = description.indexOf(TOPIC_META_PREFIX);
  if (markerIndex < 0) {
    return {
      repoName: null,
      repoOwner: null,
      activePath: null,
      activeSha: null,
    };
  }

  const raw = description.slice(markerIndex + TOPIC_META_PREFIX.length).trim();
  try {
    const parsed = JSON.parse(raw) as Partial<BcfTopicMetadata>;
    return {
      repoName: parsed.repoName ?? null,
      repoOwner: parsed.repoOwner ?? null,
      activePath: parsed.activePath ?? null,
      activeSha: parsed.activeSha ?? null,
    };
  } catch {
    return {
      repoName: null,
      repoOwner: null,
      activePath: null,
      activeSha: null,
    };
  }
}

export function stripTopicMetadata(description?: string) {
  if (!description) {
    return "";
  }

  const markerIndex = description.indexOf(TOPIC_META_PREFIX);
  return markerIndex >= 0 ? description.slice(0, markerIndex).trimEnd() : description;
}

export function withTopicMetadata(description: string | undefined, metadata: BcfTopicMetadata) {
  const clean = stripTopicMetadata(description);
  const payload = JSON.stringify(metadata);
  return clean ? `${clean}\n\n${TOPIC_META_PREFIX} ${payload}` : `${TOPIC_META_PREFIX} ${payload}`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function updateComment(comment: BCFComment, nextText: string) {
  const now = new Date().toISOString();
  comment.comment = nextText;
  comment.modifiedDate = now;
  comment.modifiedAuthor = comment.author;
  return comment;
}

function tryDecodeText(buffer: ArrayBuffer) {
  try {
    return new TextDecoder("utf-8").decode(buffer);
  } catch {
    return null;
  }
}

function looksLikePlainBcfMarkup(text: string) {
  const normalized = text.trim();
  return normalized.startsWith("<?xml") || normalized.includes("<Topic");
}

function extractElement(content: string, elementName: string) {
  const match = content.match(new RegExp(`<${elementName}>([\\s\\S]*?)<\\/${elementName}>`, "i"));
  return match?.[1]?.trim();
}

function parseCommentsFromMarkup(markupContent: string): BCFComment[] {
  const comments: BCFComment[] = [];
  const commentMatches = markupContent.matchAll(/<Comment\s+Guid="([^"]+)"[^>]*>([\s\S]*?)<\/Comment>/gi);

  for (const match of commentMatches) {
    const guid = match[1];
    const content = match[2];
    const viewpointMatch = content.match(/<Viewpoint\s+Guid="([^"]+)"/i);

    comments.push({
      guid,
      date: extractElement(content, "Date") || new Date().toISOString(),
      author: extractElement(content, "Author") || "Unknown",
      comment: extractElement(content, "Comment") || "",
      viewpointGuid: viewpointMatch?.[1],
      modifiedDate: extractElement(content, "ModifiedDate") || undefined,
      modifiedAuthor: extractElement(content, "ModifiedAuthor") || undefined,
    });
  }

  return comments;
}

function readPlainBcfMarkup(markupContent: string): BCFProject {
  const topicMatch = markupContent.match(/<Topic\s+Guid="([^"]+)"[^>]*>([\s\S]*?)<\/Topic>/i);
  if (!topicMatch) {
    throw new Error("Invalid plain BCF file: missing Topic element.");
  }

  const guid = topicMatch[1];
  const topicContent = topicMatch[2];
  const topicTypeMatch = markupContent.match(/<Topic[^>]*TopicType="([^"]+)"/i);
  const topicStatusMatch = markupContent.match(/<Topic[^>]*TopicStatus="([^"]+)"/i);
  const labels = Array.from(topicContent.matchAll(/<Labels>([^<]+)<\/Labels>/gi)).map((match) =>
    match[1].trim(),
  );

  const topic: BCFTopic = {
    guid,
    title: extractElement(topicContent, "Title") || "Untitled",
    description: extractElement(topicContent, "Description") || undefined,
    topicType: topicTypeMatch?.[1],
    topicStatus: topicStatusMatch?.[1],
    priority: extractElement(topicContent, "Priority") || undefined,
    index: extractElement(topicContent, "Index")
      ? Number.parseInt(extractElement(topicContent, "Index") as string, 10)
      : undefined,
    creationDate: extractElement(topicContent, "CreationDate") || new Date().toISOString(),
    creationAuthor: extractElement(topicContent, "CreationAuthor") || "Unknown",
    modifiedDate: extractElement(topicContent, "ModifiedDate") || undefined,
    modifiedAuthor: extractElement(topicContent, "ModifiedAuthor") || undefined,
    dueDate: extractElement(topicContent, "DueDate") || undefined,
    assignedTo: extractElement(topicContent, "AssignedTo") || undefined,
    stage: extractElement(topicContent, "Stage") || undefined,
    labels: labels.length > 0 ? labels : undefined,
    comments: parseCommentsFromMarkup(markupContent),
    viewpoints: [],
  };

  return {
    version: "2.1",
    topics: new Map([[topic.guid, topic]]),
    name: topic.title,
  };
}
