import type { NodeProps } from "@xyflow/react";

import type { MilestoneFlowNode } from "./gitFlowTypes";

export function CommitNode({ data, selected }: NodeProps<MilestoneFlowNode>) {
  const title = `${data.branchName}\n${data.shortSha} • ${data.relativeTime}\n${data.message}`;

  return (
    <div
      className={`gitflow-milestone gitflow-milestone--${data.colorToken} ${
        data.isActive || selected ? "is-active" : ""
      }`}
      title={title}
    >
      <span className="gitflow-milestone__dot" />
      {data.label ? <span className="gitflow-milestone__label">{data.label}</span> : null}
    </div>
  );
}
