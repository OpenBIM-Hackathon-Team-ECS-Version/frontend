import dagre from "@dagrejs/dagre";
import { Position, type Edge, type Node } from "@xyflow/react";

import type {
  BranchFlowNode,
  CommitFlowNode,
  GitBranch,
  GitCommit,
  GitGraphNodeData,
} from "../../types/git";

const COMMIT_WIDTH = 244;
const COMMIT_HEIGHT = 108;
const BRANCH_WIDTH = 132;
const BRANCH_HEIGHT = 34;

export function buildGitGraph(
  commits: GitCommit[],
  branches: GitBranch[],
  activeSha: string | null,
) {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "TB",
    nodesep: 42,
    ranksep: 56,
    marginx: 24,
    marginy: 24,
  });

  const commitShaSet = new Set(commits.map((commit) => commit.sha));

  commits.forEach((commit) => {
    graph.setNode(commit.sha, {
      width: COMMIT_WIDTH,
      height: COMMIT_HEIGHT,
    });
  });

  commits.forEach((commit) => {
    commit.parentShas.forEach((parentSha) => {
      if (commitShaSet.has(parentSha)) {
        graph.setEdge(commit.sha, parentSha);
      }
    });
  });

  dagre.layout(graph);

  const commitNodes = commits.map<CommitFlowNode>((commit) => {
    const position = graph.node(commit.sha);

    return {
      id: commit.sha,
      type: "commit",
      position: {
        x: position.x - COMMIT_WIDTH / 2,
        y: position.y - COMMIT_HEIGHT / 2,
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: {
        sha: commit.sha,
        message: commit.message,
        authorName: commit.authorName,
        relativeTime: commit.relativeTime,
        branchNames: commit.branchNames,
        isHead: activeSha === commit.sha,
      },
      draggable: false,
      selectable: true,
    };
  });

  const branchNodes = branches
    .filter((branch) => commitShaSet.has(branch.sha))
    .map<BranchFlowNode>((branch, index) => {
      const commitPosition = graph.node(branch.sha);
      const slot = index % 3;
      const row = Math.floor(index / 3);

      return {
        id: `branch:${branch.name}`,
        type: "branch",
        position: {
          x: commitPosition.x - BRANCH_WIDTH / 2 + slot * (BRANCH_WIDTH + 10) - BRANCH_WIDTH,
          y: commitPosition.y - COMMIT_HEIGHT / 2 - 46 - row * 40,
        },
        data: {
          name: branch.name,
        },
        draggable: false,
        selectable: false,
      };
    });

  const edges = commits.flatMap<Edge>((commit) =>
    commit.parentShas
      .filter((parentSha) => commitShaSet.has(parentSha))
      .map((parentSha) => ({
        id: `${commit.sha}-${parentSha}`,
        source: commit.sha,
        target: parentSha,
        type: "smoothstep",
        animated: activeSha === commit.sha,
      })),
  );

  return {
    nodes: [...commitNodes, ...branchNodes],
    edges,
  };
}
