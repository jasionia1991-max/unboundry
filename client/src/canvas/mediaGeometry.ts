export const NODE_DEFAULT_SIZES = {
  audio: { height: 250, width: 444 },
  image: { height: 250, width: 250 },
  playlist: { height: 104, width: 960 },
  storyboard: { height: 1000, width: 1200 },
  text: { height: 250, width: 250 },
  video: { height: 250, width: 444 },
} as const;

export { fitVisualMediaSize } from "../../../types/mediaGeometry";
