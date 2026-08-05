import type { Edge } from "@xyflow/react";

export type CuttableEdge = Edge<
  {
    animatedHighlight?: boolean;
    cutIndicator?: "click" | "hover";
    inputOrder?: number;
    inputRole?: string;
  },
  "cuttable"
>;
