import type { NodeProps } from "@xyflow/react";

import type { BranchLabelFlowNode } from "./gitFlowTypes";

export function BranchNode({ data }: NodeProps<BranchLabelFlowNode>) {
  return (
    <div className={`gitflow-label gitflow-label--${data.colorToken}`} title={data.branchName}>
      {data.displayName}
    </div>
  );
}
