import {
  Handle,
  NodeResizer,
  Position,
  useReactFlow,
  type NodeProps,
} from "@xyflow/react";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { createPortal } from "react-dom";
import { useGenerationCanvas } from "../generation/GenerationCanvasContext";
import { useCanvasCheckpoint } from "./CanvasHistory";
import { useCanvasGraphMutation } from "./CanvasGraphMutationContext";
import { useSingleNodeChrome } from "./CanvasSelectionContext";
import { useCompositionSafeText } from "./CompositionSafeText";
import {
  fetchTrustedMediaMetadata,
  hasTrustedMediaDimensions,
  trustedMediaPatch,
} from "./mediaInputMetadata";
import {
  downloadMergedPlaylist,
  PlaylistExportError,
  publishPlaylist,
} from "./playlistExport";
import type { PlaylistClip, ProbeNodeType } from "./ProbeNode";
import {
  thumbnailStrip,
  type ThumbnailStrip,
} from "./thumbnailStrip";

function time(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(
    safe % 60,
  ).padStart(2, "0")}`;
}

function preciseTime(seconds: number, step: number) {
  if (step >= 1) return time(seconds);
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const milliseconds = Math.round((safe - Math.floor(safe)) * 1_000);
  return `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(
    2,
    "0",
  )}.${String(milliseconds).padStart(3, "0")}`;
}

function downloadDirectVideo(source: string, name: string) {
  const url = new URL(source, window.location.origin);
  if (
    url.origin !== window.location.origin ||
    !(
      /^\/api\/video-assets\/[^/]+$/.test(url.pathname) ||
      /^\/fixtures\/[a-z0-9][a-z0-9._-]{0,120}\.mp4$/i.test(url.pathname)
    )
  ) {
    throw new Error("片段不是可下载的已保存视频");
  }
  const link = document.createElement("a");
  link.href = `${url.pathname}${url.search}`;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
}

async function discardPlaylistVideoAsset(assetId: string) {
  try {
    await fetch(`/api/video-assets/${encodeURIComponent(assetId)}`, {
      method: "DELETE",
    });
  } catch {
    // A fresh export that was never adopted must remain detached.
  }
}

const ClipFrame = memo(function ClipFrame({
  sourceTime,
  src,
  targetHeight,
  targetWidth,
}: {
  sourceTime: number;
  src: string;
  targetHeight: number;
  targetWidth: number;
}) {
  const fallback = useRef<HTMLVideoElement>(null);
  const [strip, setStrip] = useState<ThumbnailStrip | null>();

  useEffect(() => {
    let active = true;
    const lease = thumbnailStrip(src);
    void lease.result.then((next) => {
      if (active) setStrip(next);
    });
    return () => {
      active = false;
      lease.release();
    };
  }, [src]);

  useEffect(() => {
    const video = fallback.current;
    if (!video || video.readyState < 1) return;
    video.currentTime = Math.min(
      Math.max(0, sourceTime),
      Math.max(0, video.duration - 0.001),
    );
  }, [sourceTime]);

  if (strip === undefined) {
    return <span className="playlist-clip-frame" data-loading="true" />;
  }
  if (strip) {
    const frame = Math.max(
      0,
      Math.min(strip.count - 1, Math.floor(sourceTime / strip.interval)),
    );
    const column = frame % strip.columns;
    const row = Math.floor(frame / strip.columns);
    const coverScale = Math.max(
      targetWidth / strip.frameWidth,
      targetHeight / strip.frameHeight,
    );
    const tileWidth = strip.frameWidth * coverScale;
    const tileHeight = strip.frameHeight * coverScale;
    return (
      <span
        aria-hidden="true"
        className="playlist-clip-frame"
        data-ready="true"
        style={{
          backgroundImage: `url("${strip.url}")`,
          backgroundPosition: `${
            -column * tileWidth + (targetWidth - tileWidth) / 2
          }px ${-row * tileHeight + (targetHeight - tileHeight) / 2}px`,
          backgroundSize: `${tileWidth * strip.columns}px ${
            tileHeight * strip.rows
          }px`,
        }}
      />
    );
  }
  return (
    <video
      aria-hidden="true"
      muted
      onLoadedMetadata={(event) => {
        event.currentTarget.currentTime = Math.min(
          Math.max(0, sourceTime),
          Math.max(0, event.currentTarget.duration - 0.001),
        );
      }}
      playsInline
      preload="metadata"
      ref={fallback}
      src={src}
    />
  );
});

const RulerMarks = memo(function RulerMarks({
  majorStep,
  minorStep,
  scale,
}: {
  majorStep: number;
  minorStep: number;
  scale: number;
}) {
  const marks = Array.from(
    { length: Math.floor(scale / minorStep) + 1 },
    (_, index) => index * minorStep,
  );
  return marks.map((second, index) => {
    const major =
      Math.abs(second / majorStep - Math.round(second / majorStep)) < 0.001;
    return (
      <span
        className="playlist-ruler-mark"
        data-edge={
          index === 0
            ? "start"
            : index === marks.length - 1
              ? "end"
              : undefined
        }
        data-major={major || undefined}
        key={second}
        style={{ left: `${(second / scale) * 100}%` }}
      >
        <i />
        {major && <b>{preciseTime(second, majorStep)}</b>}
      </span>
    );
  });
});

function PlaylistPlayer({
  clips,
  currentTime,
  maxFrameHeight,
  playing,
  previewing,
  onClose,
  onPlayingChange,
  onTimeChange,
}: {
  clips: PlaylistClip[];
  currentTime: number;
  maxFrameHeight: number;
  playing: boolean;
  previewing: boolean;
  onClose: () => void;
  onPlayingChange: (playing: boolean) => void;
  onTimeChange: (seconds: number) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const playingRef = useRef(playing);
  const previewingRef = useRef(previewing);
  playingRef.current = playing;
  previewingRef.current = previewing;
  const [muted, setMuted] = useState(true);
  const [frame, setFrame] = useState(() => {
    const height = Math.min(428, maxFrameHeight);
    return { height, width: Math.min(760, height * (16 / 9)) };
  });
  const starts = useMemo(
    () =>
      clips.map((_, index) =>
        clips
          .slice(0, index)
          .reduce((sum, clip) => sum + clip.end - clip.start, 0),
      ),
    [clips],
  );
  const total = clips.reduce(
    (sum, clip) => sum + clip.end - clip.start,
    0,
  );
  const activeIndex = Math.max(
    0,
    clips.findIndex(
      (clip, index) =>
        currentTime < starts[index] + clip.end - clip.start ||
        index === clips.length - 1,
    ),
  );
  const active = clips[activeIndex];
  const sourceTime = active
    ? active.start + Math.max(0, currentTime - starts[activeIndex])
    : 0;

  useEffect(() => {
    const element = video.current;
    if (!element || !active) return;
    if (Math.abs(element.currentTime - sourceTime) > 0.015) {
      element.currentTime = sourceTime;
    }
  }, [active, sourceTime]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (playing && !previewing) {
      void element.play().catch(() => {
        if (
          element === video.current &&
          playingRef.current &&
          !previewingRef.current
        ) {
          onPlayingChange(false);
        }
      });
    } else {
      element.pause();
    }
  }, [activeIndex, playing, previewing]);

  if (!active) return null;

  return createPortal(
    <section
      aria-label="播放列表预览"
      className="playlist-player nodrag nopan nowheel"
      data-testid="playlist-player"
      data-playing={playing || undefined}
      style={{ width: frame.width }}
    >
      <video
        key={active.id}
        muted={muted}
        onEnded={() => {
          if (activeIndex < clips.length - 1) {
            onTimeChange(starts[activeIndex + 1]);
          } else {
            onPlayingChange(false);
            onTimeChange(0);
          }
        }}
        onLoadedMetadata={(event) => {
          const ratio =
            event.currentTarget.videoWidth / event.currentTarget.videoHeight ||
            16 / 9;
          const maxWidth = Math.max(280, Math.min(760, window.innerWidth - 80));
          const maxHeight = Math.max(
            220,
            Math.min(460, window.innerHeight * 0.5, maxFrameHeight),
          );
          let width = maxWidth;
          let height = width / ratio;
          if (height > maxHeight) {
            height = maxHeight;
            width = height * ratio;
          }
          setFrame({ height, width });
          event.currentTarget.currentTime = sourceTime;
          if (playing && !previewing) {
            const element = event.currentTarget;
            void element.play().catch(() => {
              if (
                element === video.current &&
                playingRef.current &&
                !previewingRef.current
              ) {
                onPlayingChange(false);
              }
            });
          }
        }}
        onPause={(event) => {
          if (
            event.currentTarget !== video.current ||
            previewingRef.current ||
            !playingRef.current
          ) {
            return;
          }
          const advancing =
            activeIndex < clips.length - 1 &&
            event.currentTarget.currentTime >= active.end - 0.03;
          if (!advancing) onPlayingChange(false);
        }}
        onTimeUpdate={(event) => {
          if (!playing || previewing) return;
          const relative = Math.min(
            active.end - active.start,
            Math.max(0, event.currentTarget.currentTime - active.start),
          );
          onTimeChange(starts[activeIndex] + relative);
          if (event.currentTarget.currentTime >= active.end - 0.03) {
            if (activeIndex < clips.length - 1) {
              onTimeChange(starts[activeIndex + 1]);
            } else {
              event.currentTarget.pause();
            }
          }
        }}
        playsInline
        ref={video}
        src={active.src}
        style={{ height: frame.height }}
      />
      <div className="playlist-player-controls">
        <button
          aria-label={playing ? "暂停" : "播放"}
          onClick={() => {
            if (!video.current) return;
            onPlayingChange(!playing);
          }}
          type="button"
        >
          {playing ? "Ⅱ" : "▶"}
        </button>
        <button
          aria-label={muted ? "开启声音" : "取消静音"}
          onClick={() => setMuted((value) => !value)}
          type="button"
        >
          {muted ? "🔇" : "🔊"}
        </button>
        <span>
          {(currentTime || 0).toFixed(1)}s/{total.toFixed(1)}s
        </span>
        <button
          aria-label="全屏"
          onClick={() => void video.current?.requestFullscreen()}
          type="button"
        >
          ⛶
        </button>
        <button aria-label="关闭" onClick={onClose} type="button">
          ×
        </button>
      </div>
    </section>,
    document.body,
  );
}

function PlaylistNodeImpl({
  data,
  dragging,
  id,
  parentId,
  selected,
}: NodeProps<ProbeNodeType>) {
  const singleNodeChrome = useSingleNodeChrome(selected, dragging);
  const hoverHead = useRef<HTMLSpanElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const editShortcutHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  const pendingHoverTime = useRef<number | null>(null);
  const trimming = useRef(false);
  const segmentGesture = useRef<
    | {
        clipId: string;
        mode?: "move" | "sort";
        nodeX: number;
        nodeY: number;
        preview: PlaylistClip[];
        startX: number;
        startY: number;
      }
    | undefined
  >(undefined);
  const timeline = useRef<HTMLDivElement>(null);
  const timelineContent = useRef<HTMLDivElement>(null);
  const viewportAnimation = useRef<number | undefined>(undefined);
  const zoomAnimation = useRef<number | undefined>(undefined);
  const zoomValue = useRef(1);
  const { getNode, getViewport, screenToFlowPosition } =
    useReactFlow<ProbeNodeType>();
  const { mutateGraph, setNodes } = useCanvasGraphMutation();
  const { accountId, canvasId, persistenceReady } = useGenerationCanvas();
  const mediaAdoptionScopeRef = useRef(`${accountId}\u0000${canvasId}`);
  mediaAdoptionScopeRef.current = `${accountId}\u0000${canvasId}`;
  const persistenceReadyLive = useRef(persistenceReady);
  persistenceReadyLive.current = persistenceReady;
  const mountedRef = useRef(true);
  const [activeClipId, setActiveClipId] = useState<string>();
  const [currentTime, setCurrentTime] = useState(0);
  const [dragVisual, setDragVisual] = useState<{
    deltaX: number;
    id: string;
  }>();
  const [exportMenu, setExportMenu] = useState(false);
  const [exportState, setExportState] = useState("");
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [sortPreview, setSortPreview] = useState<PlaylistClip[]>();
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [title, setTitle] = useState(data.title ?? "Playlist");
  const [trimPreview, setTrimPreview] = useState<{
    clipId: string;
    end: number;
    side: "left" | "right";
    start: number;
  }>();
  const [visibleRange, setVisibleRange] = useState({
    end: 60,
    pixelsPerSecond: 16,
    start: 0,
  });
  const checkpoint = useCanvasCheckpoint();
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const titleControl = useCompositionSafeText({
    onCommit: (nextTitle) => {
      setTitle(nextTitle);
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? { ...node, data: { ...node.data, title: nextTitle } }
            : node,
        ),
      );
    },
    onEditSessionStart: checkpoint,
    value: title,
  });
  const clips = data.playlistClips ?? [];
  const total = clips.reduce(
    (sum, clip) => sum + Math.max(0, clip.end - clip.start),
    0,
  );
  const scale = Math.max(60, Math.ceil(total / 10) * 10);
  const majorStep =
    timelineZoom >= 40
      ? 0.5
      : timelineZoom >= 20
        ? 1
        : timelineZoom >= 8
          ? 2
          : timelineZoom >= 3
            ? 5
            : 10;
  const minorStep = timelineZoom >= 40 ? 0.1 : majorStep / 5;
  const hasClips = clips.length > 0;
  const previewTime = hoverTime ?? currentTime;

  useEffect(() => {
    const nextTitle = data.title ?? "Playlist";
    setTitle(nextTitle);
  }, [data.title]);

  useEffect(() => {
    if (singleNodeChrome && hasClips) setPlayerOpen(true);
    if (!singleNodeChrome) {
      setExportMenu(false);
      setHoverTime(null);
      setPlaying(false);
      setPlayerOpen(false);
    }
  }, [hasClips, singleNodeChrome]);

  useEffect(() => {
    setCurrentTime((value) => Math.min(value, total));
  }, [total]);

  useEffect(
    () => () => {
      if (hoverTimer.current !== undefined) {
        window.cancelAnimationFrame(hoverTimer.current);
      }
      if (zoomAnimation.current !== undefined) {
        window.cancelAnimationFrame(zoomAnimation.current);
      }
      if (viewportAnimation.current !== undefined) {
        window.cancelAnimationFrame(viewportAnimation.current);
      }
    },
    [],
  );

  const updateData = (patch: Partial<ProbeNodeType["data"]>) => {
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, ...patch } }
          : node,
      ),
    );
  };

  const startPicking = () => {
    updateData({ playlistPicking: true });
  };

  const pointerTime = (clientX: number) => {
    const element = timelineContent.current;
    if (!element) return 0;
    const rect = element.getBoundingClientRect();
    return Math.min(
      total,
      Math.max(0, ((clientX - rect.left) / rect.width) * scale),
    );
  };

  const scheduleHover = (nextTime: number | null) => {
    pendingHoverTime.current = nextTime;
    if (hoverHead.current) {
      hoverHead.current.style.opacity = nextTime === null ? "0" : "1";
      if (nextTime !== null) {
        hoverHead.current.style.left = `${(nextTime / scale) * 100}%`;
      }
    }
    if (hoverTimer.current !== undefined) return;
    hoverTimer.current = window.requestAnimationFrame(() => {
      hoverTimer.current = undefined;
      setHoverTime(pendingHoverTime.current);
    });
  };

  const scheduleVisibleRange = () => {
    if (viewportAnimation.current !== undefined) return;
    viewportAnimation.current = window.requestAnimationFrame(() => {
      viewportAnimation.current = undefined;
      const element = timeline.current;
      const content = timelineContent.current;
      if (!element || !content) return;
      const contentWidth = Math.max(1, content.getBoundingClientRect().width);
      const viewportWidth = Math.max(1, element.clientWidth - 16);
      setVisibleRange({
        end: Math.min(
          scale,
          ((element.scrollLeft + viewportWidth) / contentWidth) * scale,
        ),
        pixelsPerSecond: contentWidth / scale,
        start: Math.max(0, (element.scrollLeft / contentWidth) * scale),
      });
    });
  };

  useEffect(() => {
    const element = timeline.current;
    if (!element) return;
    const observer = new ResizeObserver(scheduleVisibleRange);
    observer.observe(element);
    scheduleVisibleRange();
    return () => observer.disconnect();
  }, [scale]);

  const zoomTimeline = (event: ReactWheelEvent<HTMLDivElement>) => {
    const element = timeline.current;
    const content = timelineContent.current;
    if (!element || !content) return;
    event.preventDefault();
    event.stopPropagation();
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) && !event.ctrlKey) {
      element.scrollLeft += event.deltaX;
      return;
    }
    const oldZoom = zoomValue.current;
    const nextZoom = Math.min(
      64,
      Math.max(1, oldZoom * Math.exp(-event.deltaY * 0.003)),
    );
    if (Math.abs(nextZoom - oldZoom) < 0.001) return;
    const rect = element.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const ratio =
      (element.scrollLeft + pointerX - 8) /
      Math.max(1, content.getBoundingClientRect().width);
    zoomValue.current = nextZoom;
    content.style.width = `${nextZoom * 100}%`;
    element.scrollLeft =
      ratio * content.getBoundingClientRect().width - pointerX + 8;
    if (zoomAnimation.current !== undefined) return;
    zoomAnimation.current = window.requestAnimationFrame(() => {
      zoomAnimation.current = undefined;
      setTimelineZoom(zoomValue.current);
      scheduleVisibleRange();
    });
  };

  const beginTrim = (
    index: number,
    side: "left" | "right",
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const contentWidth =
      timelineContent.current?.getBoundingClientRect().width ?? 1;
    const clip = clips[index];
    const originX = event.clientX;
    const originStart = clip.start;
    const originEnd = clip.end;
    const sourceStart = clip.sourceStart ?? 0;
    const sourceEnd = clip.sourceEnd ?? clip.end;
    const minimum = 1 / 30;
    const timelineOffset = clips
      .slice(0, index)
      .reduce((sum, item) => sum + item.end - item.start, 0);
    let frame: number | undefined;
    let pending: PlaylistClip | undefined;
    event.preventDefault();
    event.stopPropagation();
    setActiveClipId(clip.id);
    trimming.current = true;
    setTrimPreview({
      clipId: clip.id,
      end: originEnd,
      side,
      start: originStart,
    });
    checkpoint();
    const apply = () => {
      frame = undefined;
      if (!pending) return;
      const next = pending;
      setTrimPreview({
        clipId: clip.id,
        end: next.end,
        side,
        start: next.start,
      });
      setHoverTime(
        timelineOffset +
          (side === "left"
            ? next.start - originStart
            : next.end - originStart),
      );
    };
    const move = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      const delta = ((pointerEvent.clientX - originX) / contentWidth) * scale;
      pending =
        side === "left"
          ? {
              ...clip,
              start: Math.min(
                originEnd - minimum,
                Math.max(sourceStart, originStart + delta),
              ),
            }
          : {
              ...clip,
              end: Math.max(
                originStart + minimum,
                Math.min(sourceEnd, originEnd + delta),
              ),
            };
      if (frame === undefined) frame = window.requestAnimationFrame(apply);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      apply();
      const next = pending;
      trimming.current = false;
      setTrimPreview(undefined);
      setHoverTime(null);
      if (next) {
        updateData({
          playlistClips: clips.map((item, clipIndex) =>
            clipIndex === index ? next : item,
          ),
        });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  };

  const beginSegmentGesture = (
    clip: PlaylistClip,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if ((event.target as Element).closest(".playlist-trim-handle")) return;
    const node = getNode(id);
    if (!node) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveClipId(clip.id);
    setNodes((nodes) =>
      nodes.map((item) => ({ ...item, selected: item.id === id })),
    );
    segmentGesture.current = {
      clipId: clip.id,
      nodeX: node.position.x,
      nodeY: node.position.y,
      preview: clips,
      startX: event.clientX,
      startY: event.clientY,
    };

    const move = (pointerEvent: PointerEvent) => {
      const gesture = segmentGesture.current;
      if (!gesture) return;
      const deltaX = pointerEvent.clientX - gesture.startX;
      const deltaY = pointerEvent.clientY - gesture.startY;
      if (!gesture.mode) {
        if (Math.hypot(deltaX, deltaY) < 5) return;
        gesture.mode =
          Math.abs(deltaX) > Math.abs(deltaY) ? "sort" : "move";
        checkpoint();
      }
      pointerEvent.preventDefault();
      const canvasZoom = getViewport().zoom || 1;
      if (gesture.mode === "move") {
        setNodes((nodes) =>
          nodes.map((item) =>
            item.id === id
              ? {
                  ...item,
                  position: {
                    x: gesture.nodeX + deltaX / canvasZoom,
                    y: gesture.nodeY + deltaY / canvasZoom,
                  },
                }
              : item,
          ),
        );
        return;
      }

      setDragVisual({ deltaX: deltaX / canvasZoom, id: clip.id });
      const dragged = gesture.preview.find((item) => item.id === clip.id);
      if (!dragged) return;
      const targetTime = pointerTime(pointerEvent.clientX);
      const rest = gesture.preview.filter((item) => item.id !== clip.id);
      let cursor = 0;
      let insertAt = rest.length;
      for (const [index, item] of rest.entries()) {
        const duration = item.end - item.start;
        if (targetTime < cursor + duration / 2) {
          insertAt = index;
          break;
        }
        cursor += duration;
      }
      const next = [...rest];
      next.splice(insertAt, 0, dragged);
      if (
        next.some((item, index) => item.id !== gesture.preview[index]?.id)
      ) {
        gesture.preview = next;
        setSortPreview(next);
      }
    };

    const end = (pointerEvent: PointerEvent) => {
      const gesture = segmentGesture.current;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      segmentGesture.current = undefined;
      setDragVisual(undefined);
      setSortPreview(undefined);
      if (!gesture?.mode) {
        setCurrentTime(pointerTime(pointerEvent.clientX));
      } else if (gesture.mode === "sort") {
        updateData({ playlistClips: gesture.preview });
      }
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  };

  const editPoint = (() => {
    let cursor = 0;
    for (const [index, clip] of clips.entries()) {
      const duration = clip.end - clip.start;
      if (currentTime <= cursor + duration) {
        const local = currentTime - cursor;
        return {
          clip,
          cursor,
          index,
          left: local,
          right: duration - local,
          split: clip.start + local,
        };
      }
      cursor += duration;
    }
    return undefined;
  })();
  const cuttable = Boolean(
    editPoint && editPoint.left >= 1 && editPoint.right >= 1,
  );

  const cut = () => {
    if (!cuttable || !editPoint) return;
    const stamp = Date.now();
    const leftId = `${editPoint.clip.id}-a-${stamp}`;
    const rightId = `${editPoint.clip.id}-b-${stamp}`;
    checkpoint();
    updateData({
      playlistClips: [
        ...clips.slice(0, editPoint.index),
        {
          ...editPoint.clip,
          end: editPoint.split,
          id: leftId,
        },
        {
          ...editPoint.clip,
          id: rightId,
          start: editPoint.split,
        },
        ...clips.slice(editPoint.index + 1),
      ],
    });
    setActiveClipId(rightId);
  };

  const trimLeft = () => {
    if (!editPoint || editPoint.left < 0.1) return;
    checkpoint();
    updateData({
      playlistClips: clips.map((clip, index) =>
        index === editPoint.index
          ? { ...clip, start: editPoint.split }
          : clip,
      ),
    });
    setCurrentTime(editPoint.cursor);
  };

  const trimRight = () => {
    if (!editPoint || editPoint.right < 0.1) return;
    checkpoint();
    updateData({
      playlistClips: clips.map((clip, index) =>
        index === editPoint.index ? { ...clip, end: editPoint.split } : clip,
      ),
    });
  };

  const downloadMerged = () => {
    setExportState("正在合并视频…");
    try {
      downloadMergedPlaylist(
        clips,
        `${title || "Playlist"}.mp4`,
      );
      setExportState("下载已开始");
    } catch (error) {
      setExportState(error instanceof Error ? error.message : "导出失败");
    }
  };

  const downloadOriginalClips = async () => {
    setExportState("正在准备原始片段…");
    try {
      for (const [index, clip] of clips.entries()) {
        downloadDirectVideo(
          clip.src,
          `${index + 1}-${clip.title || "片段"}.mp4`,
        );
        await new Promise((resolve) => window.setTimeout(resolve, 120));
      }
      setExportState(`已下载 ${clips.length} 个原始片段`);
    } catch (error) {
      setExportState(error instanceof Error ? error.message : "下载失败");
    } finally {
      setExportMenu(false);
    }
  };

  editShortcutHandler.current = (event: KeyboardEvent) => {
      if (!singleNodeChrome || !hasClips) return;
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.target instanceof Element &&
          Boolean(event.target.closest("input, textarea, [contenteditable=true]"))
      ) {
        return;
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        activeClipId &&
        clips.some((clip) => clip.id === activeClipId)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        checkpoint();
        updateData({
          playlistClips: clips.filter((clip) => clip.id !== activeClipId),
        });
        setActiveClipId(undefined);
        return;
      }
      const key = event.key.toLowerCase();
      if (event.code === "Space") {
        if (!event.repeat) {
          setHoverTime(null);
          setPlaying((value) => !value);
        }
      } else if (key === "c") cut();
      else if (key === "q") trimLeft();
      else if (key === "e") trimRight();
      else return;
      event.preventDefault();
  };

  useEffect(() => {
    const edit = (event: KeyboardEvent) => editShortcutHandler.current(event);
    window.addEventListener("keydown", edit, true);
    return () => window.removeEventListener("keydown", edit, true);
  }, []);

  const renderedClips = sortPreview ?? clips;
  const originalOffsets = new Map<string, number>();
  const previewOffsets = new Map<string, number>();
  let originalCursor = 0;
  let previewCursor = 0;
  for (const clip of clips) {
    originalOffsets.set(clip.id, originalCursor);
    originalCursor += clip.end - clip.start;
  }
  for (const clip of renderedClips) {
    previewOffsets.set(clip.id, previewCursor);
    previewCursor += clip.end - clip.start;
  }
  return (
    <>
      <NodeResizer
        color="transparent"
        isVisible={singleNodeChrome}
        minHeight={104}
        minWidth={250}
        onResizeStart={() => checkpoint()}
      />
      <Handle id="target" position={Position.Left} type="target" />

      <div
        className="playlist-node"
        data-picking={data.playlistPicking || undefined}
      >
        {singleNodeChrome && hasClips && (
          <div
            className="playlist-node-actions nodrag nopan"
            data-testid="playlist-node-actions"
          >
            <button
              aria-label={cuttable ? "切割播放列表" : "切割位置小于1秒"}
              disabled={!cuttable}
              onClick={cut}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <circle cx="7" cy="17" r="3" />
                <circle cx="17" cy="17" r="3" />
                <path d="M9.15 14.85 18 4M6 4l8.85 10.85" />
              </svg>
            </button>
            <button
              aria-expanded={exportMenu}
              aria-label="导出播放列表"
              onClick={() => setExportMenu((value) => !value)}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 11l5 5 5-5M12 4v12" />
              </svg>
            </button>
            {exportMenu && (
              <div
                aria-label="导出播放列表"
                className="playlist-export-menu"
                data-testid="playlist-export-menu"
                role="menu"
              >
                <button
                  onClick={() => {
                    void downloadOriginalClips();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span>⇩</span>下载原始片段（mp4）
                </button>
                <button
                  onClick={() => {
                    downloadMerged();
                    setExportMenu(false);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span>⇩</span>下载合并视频（mp4）
                </button>
                <button
                  onClick={() => {
                    if (!persistenceReadyLive.current) return;
                    const scope = mediaAdoptionScopeRef.current;
                    const requestedAssetId = `${crypto.randomUUID()}.mp4`;
                    setExportState("正在合并视频…");
                    void publishPlaylist(
                      clips,
                      requestedAssetId,
                      `${title || "Playlist"}.mp4`,
                    )
                      .then(async (asset) => {
                        if (asset.assetId !== requestedAssetId) {
                          throw new Error("服务端返回的视频素材标识不一致");
                        }
                        const trustedMetadata =
                          Number.isSafeInteger(asset.byteSize) &&
                            Number(asset.byteSize) > 0 &&
                            asset.contentType === "video/mp4" &&
                            Number.isFinite(asset.durationSeconds) &&
                            (asset.storageBackend === "local" ||
                              asset.storageBackend === "oss") &&
                            hasTrustedMediaDimensions(asset)
                            ? {
                                assetId: asset.assetId,
                                byteSize: Number(asset.byteSize),
                                contentType: asset.contentType,
                                durationSeconds: Number(asset.durationSeconds),
                                durationStatus: "ready" as const,
                                kind: "video" as const,
                                mediaHeight: asset.mediaHeight,
                                mediaWidth: asset.mediaWidth,
                                storageBackend: asset.storageBackend,
                              }
                            : await fetchTrustedMediaMetadata(
                                "video",
                                asset.assetId,
                              );
                        if (!hasTrustedMediaDimensions(trustedMetadata)) {
                          throw new Error("服务端返回的视频尺寸未经可信校验");
                        }
                        if (
                          !mountedRef.current ||
                          !persistenceReadyLive.current ||
                          mediaAdoptionScopeRef.current !== scope ||
                          !getNode(id)
                        ) {
                          await discardPlaylistVideoAsset(asset.assetId);
                          return;
                        }
                        const nodeId = `video-from-${id}-${Date.now()}`;
                        const position = screenToFlowPosition({
                          x: window.innerWidth / 2 - 222,
                          y: window.innerHeight / 2 - 125,
                        });
                        const adopted = await mutateGraph(({ edges, nodes }) => {
                          if (!nodes.some((node) => node.id === id)) {
                            return { edges, nodes };
                          }
                          return {
                            edges,
                            nodes: [
                              ...nodes,
                            {
                              id: nodeId,
                              type: "video",
                              position,
                              data: {
                                assetId: asset.assetId,
                                ...trustedMediaPatch(trustedMetadata),
                                label: "Video",
                                sourceKind: "video",
                                title: title || "Playlist",
                                videoAudioEnabled: true,
                                videoCreatedAt: new Intl.DateTimeFormat(
                                  "zh-CN",
                                ).format(new Date()),
                                videoDuration:
                                  trustedMetadata.durationSeconds ?? total,
                                videoFileSize: trustedMetadata.byteSize,
                                videoHeight: trustedMetadata.mediaHeight,
                                videoModel: "播放列表导出",
                                videoPrompt: "",
                                videoSrc: asset.url,
                                videoWidth: trustedMetadata.mediaWidth,
                              },
                              style: { height: 250, width: 444 },
                            },
                            ],
                          };
                        });
                        if (!adopted) {
                          await discardPlaylistVideoAsset(asset.assetId);
                          return;
                        }
                        setExportState("已导出到画布中央");
                      })
                      .catch(async (error) => {
                        if (
                          !(error instanceof PlaylistExportError) ||
                          error.status !== 409
                        ) {
                          await discardPlaylistVideoAsset(requestedAssetId);
                        }
                        setExportState(
                          error instanceof Error ? error.message : "导出失败",
                        );
                      })
                      .finally(() => setExportMenu(false));
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span>⇧</span>导出到画布
                </button>
              </div>
            )}
          </div>
        )}
        <div
          className="canvas-node-title playlist-node-title"
          data-parent-group-id={parentId}
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <rect height="14" rx="2" width="14" x="3" y="3" />
            <path d="M3 7h3M3 13h3M14 7h3M14 13h3M7 3v14M13 3v14" />
          </svg>
          {singleNodeChrome ? (
            <input
              aria-label="Playlist 标题"
              className="nodrag"
              data-canvas-text-edit="graph"
              data-composition-active={titleControl.composing || undefined}
              data-testid="playlist-node-title-input"
              onBlur={() => titleControl.blur()}
              onChange={(event) => {
                titleControl.change(
                  event.target.value,
                  (event.nativeEvent as InputEvent).isComposing,
                );
              }}
              onCompositionEnd={(event) =>
                titleControl.compositionEnd(event.currentTarget.value)
              }
              onCompositionStart={() => titleControl.compositionStart()}
              onKeyDown={(event) => {
                if (titleControl.keyDown(event) !== undefined) return;
                event.stopPropagation();
                if (
                  titleControl.composing ||
                  event.nativeEvent.isComposing ||
                  event.keyCode === 229
                ) {
                  return;
                }
                if (event.key === "Escape" || event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              placeholder="请输入标题"
              value={titleControl.value}
            />
          ) : (
            <span title={titleControl.committedValue}>
              {titleControl.committedValue}
            </span>
          )}
        </div>

        <div
          className="playlist-node-card nowheel"
          data-current-time={currentTime.toFixed(3)}
          data-preview-time={previewTime.toFixed(3)}
          data-testid={`playlist-node-${id}`}
          data-timeline-zoom={timelineZoom.toFixed(3)}
          data-total-duration={total.toFixed(3)}
          onPointerLeave={() => scheduleHover(null)}
          onPointerMove={(event) => {
            if (hasClips && !segmentGesture.current && !trimming.current) {
              scheduleHover(pointerTime(event.clientX));
            }
          }}
          onScroll={scheduleVisibleRange}
          onWheel={zoomTimeline}
          ref={timeline}
        >
          <div
            className="playlist-timeline-content"
            ref={timelineContent}
            style={{ width: `${timelineZoom * 100}%` }}
          >
            <div
              className="playlist-ruler nodrag"
              data-testid="playlist-ruler"
              onClick={(event) => {
                if (!hasClips) return;
                setCurrentTime(pointerTime(event.clientX));
              }}
            >
              <RulerMarks
                majorStep={majorStep}
                minorStep={minorStep}
                scale={scale}
              />
            </div>
            {hasClips ? (
              <div className="playlist-track" data-testid="playlist-track">
                {renderedClips.map((clip) => {
                  const duration = clip.end - clip.start;
                  const index = clips.findIndex((item) => item.id === clip.id);
                  const offset = previewOffsets.get(clip.id) ?? 0;
                  const viewportDuration = Math.max(
                    0.5,
                    visibleRange.end - visibleRange.start,
                  );
                  const frameStep = Math.max(
                    0.1,
                    72 /
                      Math.max(
                        1,
                        (((timeline.current?.clientWidth ?? 960) - 16) /
                          scale) *
                          timelineZoom,
                      ),
                  );
                  const visibleStart = Math.max(
                    0,
                    visibleRange.start - viewportDuration - offset,
                  );
                  const visibleEnd = Math.min(
                    duration,
                    visibleRange.end + viewportDuration - offset,
                  );
                  const firstFrame = Math.max(
                    0,
                    Math.floor(visibleStart / frameStep),
                  );
                  const lastFrame = Math.max(
                    firstFrame,
                    Math.min(
                      Math.ceil(duration / frameStep),
                      Math.ceil(visibleEnd / frameStep),
                    ),
                  );
                  const active = clip.id === activeClipId;
                  const dragging = clip.id === dragVisual?.id;
                  const trimmingClip =
                    trimPreview?.clipId === clip.id ? trimPreview : undefined;
                  const leftTrimPercent = trimmingClip
                    ? ((trimmingClip.start - clip.start) / duration) * 100
                    : 0;
                  const rightTrimPercent = trimmingClip
                    ? ((clip.end - trimmingClip.end) / duration) * 100
                    : 0;
                  return (
                    <div
                      className={`playlist-segment nodrag${
                        active ? " playlist-segment-active" : ""
                      }${dragging ? " playlist-segment-dragging" : ""}`}
                      data-clip-end={clip.end.toFixed(3)}
                      data-clip-start={clip.start.toFixed(3)}
                      data-testid="playlist-segment"
                      key={clip.id}
                      onPointerDown={(event) =>
                        beginSegmentGesture(clip, event)
                      }
                      style={{
                        left: `${
                          ((dragging
                            ? originalOffsets.get(clip.id)
                            : previewOffsets.get(clip.id)) ?? 0) /
                          scale *
                          100
                        }%`,
                        transform: dragging
                          ? `translateX(${dragVisual.deltaX}px)`
                          : undefined,
                        width: `${(duration / scale) * 100}%`,
                      }}
                      title={clip.title}
                    >
                      <div className="playlist-segment-frames">
                        {Array.from(
                          { length: Math.max(0, lastFrame - firstFrame) },
                          (_, visibleIndex) => {
                            const frameIndex = firstFrame + visibleIndex;
                            const localTime = frameIndex * frameStep;
                            return (
                              <span
                                className="playlist-frame-slot"
                                key={`${clip.id}-${frameStep}-${frameIndex}`}
                                style={{
                                  left: `${(localTime / duration) * 100}%`,
                                  width: `${Math.min(
                                    100 - (localTime / duration) * 100,
                                    (frameStep / duration) * 100,
                                  )}%`,
                                }}
                              >
                                <ClipFrame
                                  sourceTime={
                                    clip.start +
                                    Math.min(
                                      duration - 0.001,
                                      localTime + frameStep / 2,
                                    )
                                  }
                                  src={clip.src}
                                  targetHeight={Math.max(
                                    1,
                                    (timeline.current?.clientHeight ?? 104) - 18,
                                  )}
                                  targetWidth={Math.max(
                                    1,
                                    Math.min(
                                      frameStep,
                                      duration - localTime,
                                    ) *
                                      Math.max(
                                        1,
                                        (((timeline.current?.clientWidth ??
                                          960) -
                                          16) /
                                          scale) *
                                          timelineZoom,
                                      ),
                                  )}
                                />
                              </span>
                            );
                          },
                        )}
                      </div>
                      <span className="playlist-segment-title">
                        {clip.title}
                      </span>
                      <span className="playlist-segment-duration">
                        {duration.toFixed(1)}s
                      </span>
                      {active && (
                        <>
                          {trimmingClip && leftTrimPercent > 0 && (
                            <span
                              className="playlist-trim-mask playlist-trim-mask-left"
                              style={{ width: `${leftTrimPercent}%` }}
                            />
                          )}
                          {trimmingClip && rightTrimPercent > 0 && (
                            <span
                              className="playlist-trim-mask playlist-trim-mask-right"
                              style={{ width: `${rightTrimPercent}%` }}
                            />
                          )}
                          <button
                            aria-label="裁剪片段左侧"
                            className="playlist-trim-handle playlist-trim-left nodrag nopan"
                            onPointerDown={(event) =>
                              beginTrim(index, "left", event)
                            }
                            style={
                              trimmingClip?.side === "left"
                                ? {
                                    left: `${leftTrimPercent}%`,
                                    right: "auto",
                                    transform: "translate(-50%, -50%)",
                                  }
                                : undefined
                            }
                            type="button"
                          />
                          <button
                            aria-label="裁剪片段右侧"
                            className="playlist-trim-handle playlist-trim-right nodrag nopan"
                            onPointerDown={(event) =>
                              beginTrim(index, "right", event)
                            }
                            style={
                              trimmingClip?.side === "right"
                                ? {
                                    left: `${100 - rightTrimPercent}%`,
                                    right: "auto",
                                    transform: "translate(-50%, -50%)",
                                  }
                                : undefined
                            }
                            type="button"
                          />
                          {trimmingClip && (
                            <span
                              className="playlist-trim-time"
                              style={{
                                left:
                                  trimmingClip.side === "left"
                                    ? `${leftTrimPercent}%`
                                    : `${100 - rightTrimPercent}%`,
                              }}
                            >
                              {(
                                trimmingClip.side === "left"
                                  ? trimmingClip.start
                                  : trimmingClip.end
                              ).toFixed(1)}
                              s
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
                <button
                  aria-label="添加片段"
                  className="playlist-track-add nodrag nopan"
                  onClick={startPicking}
                  style={{ left: `${(total / scale) * 100}%` }}
                  type="button"
                >
                  +
                </button>
              </div>
            ) : (
              <div className="playlist-empty">
                <button
                  aria-label="添加片段"
                  className="playlist-add nodrag nopan"
                  onClick={startPicking}
                  type="button"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
                <span>
                  {data.playlistPicking
                    ? "选择要添加的片段 · ESC 退出"
                    : "轻点 + 在画布上选取视频"}
                </span>
              </div>
            )}
            {hasClips && (
              <>
                <span
                  aria-hidden="true"
                  className="playlist-playhead playlist-playhead-committed"
                  data-testid="playlist-playhead"
                  style={{ left: `${(currentTime / scale) * 100}%` }}
                >
                  <i />
                </span>
                <span
                  aria-hidden="true"
                  className="playlist-playhead playlist-previewhead"
                  data-testid="playlist-previewhead"
                  ref={hoverHead}
                  style={{
                    left: `${((hoverTime ?? currentTime) / scale) * 100}%`,
                    opacity: hoverTime === null ? 0 : 1,
                  }}
                >
                  <i />
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <Handle id="source" position={Position.Right} type="source" />
      {exportState &&
        createPortal(
          <output className="playlist-export-state" role="status">
            {exportState}
          </output>,
          document.body,
        )}
      {singleNodeChrome && hasClips && !data.playlistPicking && playerOpen && (
        <PlaylistPlayer
          clips={clips}
          currentTime={previewTime}
          maxFrameHeight={Math.max(
            180,
            Math.min(
              460,
              (timeline.current?.getBoundingClientRect().top ??
                window.innerHeight * 0.62) - 64,
            ),
          )}
          onClose={() => {
            setPlaying(false);
            setPlayerOpen(false);
          }}
          onPlayingChange={setPlaying}
          onTimeChange={(nextTime) => {
            setHoverTime(null);
            setCurrentTime(nextTime);
          }}
          playing={playing}
          previewing={hoverTime !== null}
        />
      )}
    </>
  );
}
export const PlaylistNode = memo(PlaylistNodeImpl);
