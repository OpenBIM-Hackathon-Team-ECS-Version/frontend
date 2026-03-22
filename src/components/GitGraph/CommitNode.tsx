import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { CommitFlowNode } from "../../types/git";

export function CommitNode({ data, selected }: NodeProps<CommitFlowNode>) {
  return (
    <div
      className={`commit-card ${selected || data.isHead ? "is-active" : ""} ${data.isRelevant ? "is-relevant" : "is-muted"}`}
    >
      <Handle type="target" position={Position.Top} className="commit-card__handle" />
      <div className="commit-card__topline">
        <span className="commit-card__sha">{data.sha.slice(0, 7)}</span>
        {data.isHead ? <span className="commit-card__head">active</span> : null}
      </div>
      <div className="commit-card__message">{data.message.split("\n")[0]}</div>
      <div className="commit-card__meta">
        <span>{data.authorName}</span>
        <span>{data.relativeTime}</span>
      </div>
      <div className="commit-card__branches">
        {data.branchNames.slice(0, 3).map((branch) => (
          <span key={branch} className="commit-card__branch">
            {branch}
          </span>
        ))}
      </div>
      <Handle type="source" position={Position.Bottom} className="commit-card__handle" />
    </div>
  );
}
