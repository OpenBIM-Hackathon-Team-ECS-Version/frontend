import { useMemo } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type NodeTypes,
} from "@xyflow/react";

import { useAppStore } from "../../store/useAppStore";
import { BranchNode } from "./BranchNode";
import { CommitNode } from "./CommitNode";
import { buildGitGraph } from "./gitGraphLayout";

const nodeTypes: NodeTypes = {
  branchLabel: BranchNode,
  milestone: CommitNode,
};

export function GitGraph() {
  const commits = useAppStore((state) => state.commits);
  const branches = useAppStore((state) => state.branches);
  const activeSha = useAppStore((state) => state.activeSha);
  const setActiveSha = useAppStore((state) => state.setActiveSha);

  const { nodes, edges } = useMemo(
    () => buildGitGraph(commits, branches, activeSha),
    [activeSha, branches, commits],
  );

  return (
    <div className="panel panel--graph">
      <div className="panel__eyebrow">Commit graph</div>
      <div className="graph-shell">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            nodeTypes={nodeTypes}
            colorMode="dark"
            minZoom={0.45}
            maxZoom={1.2}
            panOnDrag
            nodesDraggable={false}
            elementsSelectable
            onNodeClick={(_, node) => {
              if (node.type === "milestone" && typeof node.data?.sha === "string") {
                setActiveSha(node.data.sha);
              }
            }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={22} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  );
}
