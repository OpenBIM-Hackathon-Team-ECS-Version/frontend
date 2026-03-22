import type { NodeProps } from "@xyflow/react";

import type { BranchFlowNode } from "../../types/git";

export function BranchNode({ data }: NodeProps<BranchFlowNode>) {
  return <div className="branch-pill">{data.name}</div>;
}
