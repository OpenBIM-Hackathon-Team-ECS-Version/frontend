import dagre from "@dagrejs/dagre";
import { Position } from "@xyflow/react";

import type { GitBranch, GitCommit } from "../../types/git";
import { buildGitFlowModel } from "./gitFlowModel";
import type { BranchLabelFlowNode, GitFlowEdge, MilestoneFlowNode } from "./gitFlowTypes";

const LABEL_WIDTH = 118;
const LABEL_HEIGHT = 42;
const MILESTONE_SIZE = 20;
const LANE_HEIGHT = 124;
const GRAPH_MARGIN_X = 52;
const GRAPH_MARGIN_Y = 54;

function getMilestoneLabel(commit: GitCommit, isActive: boolean) {
  if (isActive) {
    return "Now";
  }

  const firstLine = commit.message.split("\n")[0] ?? "";
  const versionMatch = firstLine.match(/\b(v?\d+\.\d+(?:\.\d+)*)\b/i);
  return versionMatch?.[1] ?? null;
}

function getEdgeStyle(kind: "lane" | "branch" | "merge", isHighlighted: boolean) {
  if (kind === "lane") {
    return {
      stroke: isHighlighted ? "rgba(214, 234, 255, 0.92)" : "rgba(214, 234, 255, 0.34)",
      strokeWidth: isHighlighted ? 3.6 : 3,
    };
  }

  if (kind === "branch") {
    return {
      stroke: "rgba(214, 234, 255, 0.46)",
      strokeWidth: 2.8,
    };
  }

  return {
    stroke: "rgba(214, 234, 255, 0.4)",
    strokeWidth: 2.8,
  };
}

export function buildGitGraph(
  commits: GitCommit[],
  branches: GitBranch[],
  activeSha: string | null,
) {
  const model = buildGitFlowModel(commits, branches, activeSha);
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    nodesep: 26,
    ranksep: 86,
    marginx: GRAPH_MARGIN_X,
    marginy: GRAPH_MARGIN_Y,
  });

  model.lanes.forEach((lane) => {
    const labelId = `label:${lane.branchName}`;
    graph.setNode(labelId, {
      width: LABEL_WIDTH,
      height: LABEL_HEIGHT,
    });

    const firstMilestone = model.milestones.find((entry) => entry.branchName === lane.branchName);
    if (firstMilestone) {
      graph.setEdge(labelId, firstMilestone.id);
    }
  });

  model.milestones.forEach((milestone) => {
    graph.setNode(milestone.id, {
      width: MILESTONE_SIZE,
      height: MILESTONE_SIZE,
    });
  });

  model.connectors.forEach((connector) => {
    graph.setEdge(connector.sourceId, connector.targetId, {
      weight: connector.kind === "lane" ? 3 : 1,
    });
  });

  dagre.layout(graph);

  const nodes: Array<BranchLabelFlowNode | MilestoneFlowNode> = [];
  const edges: GitFlowEdge[] = [];

  model.lanes.forEach((lane) => {
    const position = graph.node(`label:${lane.branchName}`);
    if (!position) {
      return;
    }

    nodes.push({
      id: `label:${lane.branchName}`,
      type: "branchLabel",
      position: {
        x: position.x - LABEL_WIDTH / 2,
        y: lane.index * LANE_HEIGHT,
      },
      data: {
        branchName: lane.branchName,
        displayName: model.displayNames.get(lane.branchName) ?? lane.branchName,
        role: lane.role,
        colorToken: lane.colorToken,
      },
      draggable: false,
      selectable: false,
    });
  });

  model.milestones.forEach((milestone) => {
    const position = graph.node(milestone.id);
    if (!position) {
      return;
    }

    const isActive = milestone.sha === activeSha;
    nodes.push({
      id: milestone.id,
      type: "milestone",
      position: {
        x: position.x - MILESTONE_SIZE / 2,
        y: milestone.laneIndex * LANE_HEIGHT + 82,
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        sha: milestone.sha,
        shortSha: milestone.commit.shortSha,
        branchName: milestone.branchName,
        role: milestone.role,
        kind: milestone.kind,
        colorToken: milestone.role === "other" ? "other" : milestone.role,
        isActive,
        message: milestone.commit.message.split("\n")[0] ?? milestone.commit.message,
        relativeTime: milestone.commit.relativeTime,
        label: getMilestoneLabel(milestone.commit, isActive),
      },
      draggable: false,
      selectable: true,
    });
  });

  model.connectors.forEach((connector) => {
    const source = model.milestones.find((milestone) => milestone.id === connector.sourceId);
    const target = model.milestones.find((milestone) => milestone.id === connector.targetId);
    const isHighlighted = source?.sha === activeSha || target?.sha === activeSha;

    edges.push({
      id: `${connector.kind}:${connector.sourceId}:${connector.targetId}`,
      source: connector.sourceId,
      target: connector.targetId,
      type: "smoothstep",
      animated: connector.kind !== "lane" && isHighlighted,
      style: getEdgeStyle(connector.kind, isHighlighted),
      sourceHandle: null,
      targetHandle: null,
      zIndex: connector.kind === "lane" ? 1 : 2,
    });
  });

  return { nodes, edges };
}
