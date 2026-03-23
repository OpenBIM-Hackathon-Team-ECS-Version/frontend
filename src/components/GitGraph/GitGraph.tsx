import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type NodeTypes,
} from "@xyflow/react";

import { getFileCommitHistory, mergeBranchCommits } from "../../lib/github";
import { useAppStore } from "../../store/useAppStore";
import type { GitCommit } from "../../types/git";
import { BranchNode } from "./BranchNode";
import { CommitNode } from "./CommitNode";
import { buildGitGraph } from "./gitGraphLayout";

const nodeTypes: NodeTypes = {
  branch: BranchNode,
  commit: CommitNode,
};

export function GitGraph() {
  const repo = useAppStore((state) => state.repo);
  const authToken = useAppStore((state) => state.authToken);
  const commits = useAppStore((state) => state.commits);
  const branches = useAppStore((state) => state.branches);
  const activePath = useAppStore((state) => state.activePath);
  const activeSha = useAppStore((state) => state.activeSha);
  const setActiveSha = useAppStore((state) => state.setActiveSha);
  const [relevantCommits, setRelevantCommits] = useState<GitCommit[]>([]);

  useEffect(() => {
    if (!repo || !activePath) {
      setRelevantCommits([]);
      return;
    }

    const prioritizedBranches = branches.slice(0, 6);
    if (prioritizedBranches.length === 0) {
      setRelevantCommits([]);
      return;
    }

    const repoRef = repo;
    const activePathRef = activePath;
    let cancelled = false;

    async function loadFileCommits() {
      try {
        const fileCommitsByBranch = Object.fromEntries(
          await Promise.all(
            prioritizedBranches.map(async (branch) => [
              branch.name,
              await getFileCommitHistory(repoRef, branch.name, activePathRef, authToken, 35),
            ]),
          ),
        );

        if (cancelled) {
          return;
        }

        setRelevantCommits(mergeBranchCommits(fileCommitsByBranch));
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error(error);
        setRelevantCommits([]);
      }
    }

    void loadFileCommits();

    return () => {
      cancelled = true;
    };
  }, [activePath, authToken, branches, repo]);

  const relevantShas = useMemo(
    () => new Set(relevantCommits.map((commit) => commit.sha)),
    [relevantCommits],
  );

  const { nodes, edges } = useMemo(
    () => buildGitGraph(commits, branches, activeSha, relevantShas.size > 0 ? relevantShas : undefined),
    [activeSha, branches, commits, relevantShas],
  );

  return (
    <div className="panel panel--graph">
      <div className="panel__eyebrow">Commit graph</div>
      <div className="graph-note">
        {activePath
          ? "Selected model commits are highlighted. The rest stay visible for repo context."
          : "Showing repo-wide commit context."}
      </div>
      <div className="graph-shell">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            nodeTypes={nodeTypes}
            colorMode="dark"
            minZoom={0.35}
            maxZoom={1.3}
            panOnDrag
            nodesDraggable={false}
            elementsSelectable
            onNodeClick={(_, node) => {
              if (node.type === "commit") {
                setActiveSha(node.id);
              }
            }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  );
}
