export const imageToolIds = [
  "crop",
  "multi-angle",
  "redraw",
  "outpaint",
  "erase",
  "annotation",
  "enhance",
  "resize",
  "cutout",
  "split",
  "seedance",
  "fullscreen",
] as const;

export type ImageToolId = typeof imageToolIds[number];
export type ActiveImageTool = ImageToolId | null;
export type ImageToolPresentation = "modal" | "popover";
export type ImageToolSurfaceTone = "checkerboard" | "plain";

export type ImageToolDescriptor = Readonly<{
  closeOnOutside: boolean;
  id: ImageToolId;
  inertBackground: boolean;
  label: string;
  maximumWidth: number;
  presentation: ImageToolPresentation;
  surface: ImageToolSurfaceTone;
}>;

export const imageToolDescriptors = Object.freeze({
  annotation: {
    closeOnOutside: false,
    id: "annotation",
    inertBackground: true,
    label: "图片标注",
    maximumWidth: 1120,
    presentation: "modal",
    surface: "plain",
  },
  crop: {
    closeOnOutside: false,
    id: "crop",
    inertBackground: true,
    label: "图片裁剪",
    maximumWidth: 1120,
    presentation: "modal",
    surface: "plain",
  },
  cutout: {
    closeOnOutside: true,
    id: "cutout",
    inertBackground: false,
    label: "主体抠图",
    maximumWidth: 420,
    presentation: "popover",
    surface: "plain",
  },
  enhance: {
    closeOnOutside: true,
    id: "enhance",
    inertBackground: false,
    label: "增强图片",
    maximumWidth: 420,
    presentation: "popover",
    surface: "plain",
  },
  erase: {
    closeOnOutside: false,
    id: "erase",
    inertBackground: true,
    label: "图片擦除",
    maximumWidth: 1120,
    presentation: "modal",
    surface: "plain",
  },
  fullscreen: {
    closeOnOutside: true,
    id: "fullscreen",
    inertBackground: true,
    label: "图片详情",
    maximumWidth: 1440,
    presentation: "modal",
    surface: "plain",
  },
  "multi-angle": {
    closeOnOutside: true,
    id: "multi-angle",
    inertBackground: false,
    label: "图片多角度",
    maximumWidth: 600,
    presentation: "popover",
    surface: "plain",
  },
  outpaint: {
    closeOnOutside: false,
    id: "outpaint",
    inertBackground: true,
    label: "图片扩图",
    maximumWidth: 1120,
    presentation: "modal",
    surface: "plain",
  },
  redraw: {
    closeOnOutside: false,
    id: "redraw",
    inertBackground: true,
    label: "图片重绘",
    maximumWidth: 1120,
    presentation: "modal",
    surface: "plain",
  },
  resize: {
    closeOnOutside: true,
    id: "resize",
    inertBackground: false,
    label: "调整像素",
    maximumWidth: 420,
    presentation: "popover",
    surface: "plain",
  },
  seedance: {
    closeOnOutside: true,
    id: "seedance",
    inertBackground: false,
    label: "Seedance 素材校验",
    maximumWidth: 420,
    presentation: "popover",
    surface: "plain",
  },
  split: {
    closeOnOutside: false,
    id: "split",
    inertBackground: true,
    label: "快速切分",
    maximumWidth: 1120,
    presentation: "modal",
    surface: "plain",
  },
} satisfies Record<ImageToolId, ImageToolDescriptor>);

export type ImageToolUiState = Readonly<{
  activeTool: ActiveImageTool;
  colorMenuOpen: boolean;
  moreMenuOpen: boolean;
}>;

export type ImageToolUiAction =
  | Readonly<{ tool: ImageToolId; type: "open-tool" }>
  | Readonly<{ tool?: ImageToolId; type: "close-tool" }>
  | Readonly<{ type: "toggle-color-menu" }>
  | Readonly<{ type: "toggle-more-menu" }>
  | Readonly<{ type: "close-transient-ui" }>;

export const initialImageToolUiState: ImageToolUiState = Object.freeze({
  activeTool: null,
  colorMenuOpen: false,
  moreMenuOpen: false,
});

export function reduceImageToolUiState(
  state: ImageToolUiState,
  action: ImageToolUiAction,
): ImageToolUiState {
  switch (action.type) {
    case "open-tool":
      return {
        activeTool: action.tool,
        colorMenuOpen: false,
        moreMenuOpen: false,
      };
    case "close-tool":
      return action.tool && state.activeTool !== action.tool
        ? state
        : { ...state, activeTool: null };
    case "toggle-color-menu":
      return {
        activeTool: null,
        colorMenuOpen: !state.colorMenuOpen,
        moreMenuOpen: false,
      };
    case "toggle-more-menu":
      return {
        activeTool: null,
        colorMenuOpen: false,
        moreMenuOpen: !state.moreMenuOpen,
      };
    case "close-transient-ui":
      return initialImageToolUiState;
  }
}
