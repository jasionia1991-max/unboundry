import type { Edge } from "@xyflow/react";

export type CuttableEdge = Edge<
  {
    animatedHighlight?: boolean;
    cutIndicator?: "click" | "hover";
    flowAnimated?: boolean;
    flowDirection?: 1 | -1;
    inputOrder?: number;
    inputRole?: string;
  },
  "cuttable"
>;
