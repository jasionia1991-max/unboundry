import { expect, test } from "./safe-test";
import { normalizePersistedMediaNodes } from "../types/persistedMediaSources";

test("only the exact obsolete pre-task configuration error is removed", () => {
  expect(normalizePersistedMediaNodes([
    {
      data: { imageGenerationError: "Generation provider is not configured" },
      id: "obsolete-image-error",
      type: "image",
    },
    {
      data: {
        imageGenerationError: "服务重启中断了本次生成，系统未自动重新提交，可手动重试",
      },
      id: "real-image-error",
      type: "image",
    },
    {
      data: { audioGenerationError: "Mureka RATE_LIMIT" },
      id: "real-audio-error",
      type: "audio",
    },
  ])).toEqual([
    { data: {}, id: "obsolete-image-error", type: "image" },
    {
      data: {
        imageGenerationError: "服务重启中断了本次生成，系统未自动重新提交，可手动重试",
      },
      id: "real-image-error",
      type: "image",
    },
    {
      data: { audioGenerationError: "Mureka RATE_LIMIT" },
      id: "real-audio-error",
      type: "audio",
    },
  ]);
});

test("durable asset identities replace every temporary media URL", () => {
  expect(normalizePersistedMediaNodes([
    {
      data: {
        assetId: "image asset",
        imageSrc: "https://signed.example/image.png?expires=60",
      },
      id: "image",
      type: "image",
    },
    {
      data: {
        assetId: "video-1",
        videoSrc: "blob:http://127.0.0.1/temporary",
      },
      id: "video",
      type: "video",
    },
    {
      data: {
        assetId: "audio/1",
        audioSrc: "data:audio/wav;base64,AAAA",
      },
      id: "audio",
      type: "audio",
    },
  ])).toEqual([
    {
      data: {
        assetId: "image asset",
        imageSrc: "/api/assets/image%20asset",
      },
      id: "image",
      type: "image",
    },
    {
      data: {
        assetId: "video-1",
        videoSrc: "/api/video-assets/video-1",
      },
      id: "video",
      type: "video",
    },
    {
      data: {
        assetId: "audio/1",
        audioSrc: "/api/audio-assets/audio%2F1",
      },
      id: "audio",
      type: "audio",
    },
  ]);
});

test("media nodes without an asset reject signed, data, blob and http sources", () => {
  expect(normalizePersistedMediaNodes([
    {
      data: {
        audioSrc: "/api/audio-assets/wrong-kind",
        imageSrc: "https://signed.example/image.png?expires=60",
        videoSrc: "/api/video-assets/wrong-kind",
      },
      id: "image-https",
      type: "image",
    },
    {
      data: { imageSrc: "http://unsigned.example/image.png" },
      id: "image-http",
      type: "image",
    },
    {
      data: { videoSrc: "data:video/mp4;base64,AAAA" },
      id: "video-data",
      type: "video",
    },
    {
      data: { audioSrc: "blob:http://127.0.0.1/lost" },
      id: "audio-blob",
      type: "audio",
    },
  ])).toEqual([
    {
      data: {
        inputState: "invalid",
        inputStateReason: "旧本地预览已失效，请重新上传原图（PNG、JPEG、WebP或GIF）",
      },
      id: "image-https",
      type: "image",
    },
    {
      data: {
        inputState: "invalid",
        inputStateReason: "旧本地预览已失效，请重新上传原图（PNG、JPEG、WebP或GIF）",
      },
      id: "image-http",
      type: "image",
    },
    {
      data: {
        inputState: "invalid",
        inputStateReason: "旧本地预览已失效，请重新上传原视频",
      },
      id: "video-data",
      type: "video",
    },
    {
      data: {
        inputState: "invalid",
        inputStateReason: "旧本地预览已失效，请重新上传原音频",
      },
      id: "audio-blob",
      type: "audio",
    },
  ]);
});

test("uploading is recovered only when a durable asset or local source exists", () => {
  expect(normalizePersistedMediaNodes([
    {
      data: {
        assetId: "image-ready",
        imageSrc: "blob:http://127.0.0.1/image",
        inputState: "uploading",
        inputStateReason: "图片上传中",
        mediaByteSize: 42,
      },
      id: "image-with-asset",
      type: "image",
    },
    {
      data: {
        assetId: "video-ready",
        inputState: "uploading",
        inputStateReason: "视频上传中",
        videoSrc: "https://signed.example/video.mp4",
        videoWidth: 1920,
      },
      id: "video-with-asset",
      type: "video",
    },
    {
      data: {
        assetId: "audio-ready",
        audioDuration: 12,
        audioSrc: "data:audio/wav;base64,AAAA",
        inputState: "uploading",
        inputStateReason: "音频上传中",
      },
      id: "audio-with-asset",
      type: "audio",
    },
    {
      data: { inputState: "uploading", inputStateReason: "图片上传中" },
      id: "image-interrupted",
      type: "image",
    },
    {
      data: {
        inputState: "uploading",
        inputStateReason: "视频上传中",
        videoSrc: "blob:http://127.0.0.1/video",
      },
      id: "video-interrupted",
      type: "video",
    },
    {
      data: {
        audioSrc: "https://signed.example/audio.mp3",
        inputState: "uploading",
        inputStateReason: "音频上传中",
      },
      id: "audio-interrupted",
      type: "audio",
    },
    {
      data: {
        imageSrc: "/api/assets/fixture-image",
        inputState: "uploading",
        inputStateReason: "图片上传中",
      },
      id: "image-local-source",
      type: "image",
    },
    {
      data: {
        inputState: "uploading",
        inputStateReason: "视频上传中",
        videoSrc: "/fixtures/video-success.mp4",
      },
      id: "video-fixture-source",
      type: "video",
    },
    {
      data: {
        audioSrc: "fixtures/audio-success.wav",
        inputState: "uploading",
        inputStateReason: "音频上传中",
      },
      id: "audio-fixture-source",
      type: "audio",
    },
  ])).toEqual([
    {
      data: {
        assetId: "image-ready",
        imageSrc: "/api/assets/image-ready",
        inputState: "ready",
        mediaByteSize: 42,
      },
      id: "image-with-asset",
      type: "image",
    },
    {
      data: {
        assetId: "video-ready",
        inputState: "ready",
        videoSrc: "/api/video-assets/video-ready",
        videoWidth: 1920,
      },
      id: "video-with-asset",
      type: "video",
    },
    {
      data: {
        assetId: "audio-ready",
        audioDuration: 12,
        audioSrc: "/api/audio-assets/audio-ready",
        inputState: "ready",
      },
      id: "audio-with-asset",
      type: "audio",
    },
    {
      data: {
        inputState: "invalid",
        inputStateReason: "图片上传已中断，请重新上传原图（PNG、JPEG、WebP或GIF）",
      },
      id: "image-interrupted",
      type: "image",
    },
    {
      data: {
        inputState: "invalid",
        inputStateReason: "视频上传已中断，请重新上传原视频",
      },
      id: "video-interrupted",
      type: "video",
    },
    {
      data: {
        inputState: "invalid",
        inputStateReason: "音频上传已中断，请重新上传原音频",
      },
      id: "audio-interrupted",
      type: "audio",
    },
    {
      data: {
        imageSrc: "/api/assets/fixture-image",
        inputState: "ready",
      },
      id: "image-local-source",
      type: "image",
    },
    {
      data: {
        inputState: "ready",
        videoSrc: "/fixtures/video-success.mp4",
      },
      id: "video-fixture-source",
      type: "video",
    },
    {
      data: {
        audioSrc: "fixtures/audio-success.wav",
        inputState: "ready",
      },
      id: "audio-fixture-source",
      type: "audio",
    },
  ]);
});

test("playlist persistence drops broken clips and preserves durable local clips", () => {
  const durableClips = [
    { end: 2, id: "api", sourceNodeId: "v1", src: "/api/video-assets/v1", start: 0, title: "API" },
    { end: 3, id: "fixture", sourceNodeId: "v2", src: "/fixtures/video-success.mp4", start: 0, title: "Fixture" },
    { end: 4, id: "relative", sourceNodeId: "v3", src: "fixtures/video-success.mp4", start: 0, title: "Relative" },
  ];
  const [playlist] = normalizePersistedMediaNodes([
    {
      data: {
        label: "Playlist",
        playlistClips: [
          ...durableClips,
          { end: 1, id: "blob", sourceNodeId: "v4", src: "blob:http://127.0.0.1/video", start: 0, title: "Blob" },
          { end: 1, id: "data", sourceNodeId: "v5", src: "data:video/mp4;base64,AAAA", start: 0, title: "Data" },
          { end: 1, id: "https", sourceNodeId: "v6", src: "https://signed.example/video.mp4", start: 0, title: "HTTPS" },
          { end: 1, id: "http", sourceNodeId: "v7", src: "http://signed.example/video.mp4", start: 0, title: "HTTP" },
          { end: 1, id: "empty", sourceNodeId: "v8", src: "", start: 0, title: "Empty" },
          null,
        ],
      },
      id: "playlist",
      type: "playlist",
    },
  ]);
  expect(playlist).toEqual({
    data: { label: "Playlist", playlistClips: durableClips },
    id: "playlist",
    type: "playlist",
  });
});

test("the canvas service persists only durable media state", async ({
  request,
}) => {
  const canvasId = "media-source-normalization";
  await request.delete(`/api/canvas/${canvasId}`);
  try {
    const saved = await request.put(`/api/canvas/${canvasId}`, {
      data: {
        edges: [],
        nodes: [
          {
            data: {
              assetId: "asset-image-1",
              imageSrc: "https://signed.example/image.png?expires=60",
              inputState: "uploading",
              inputStateReason: "图片上传中",
            },
            id: "image",
            type: "image",
          },
          {
            data: { videoSrc: "data:video/mp4;base64,AAAA" },
            id: "video",
            type: "video",
          },
          {
            data: {
              audioSrc: "blob:http://127.0.0.1/lost",
              inputState: "uploading",
            },
            id: "audio",
            type: "audio",
          },
          {
            data: {
              playlistClips: [
                { end: 2, id: "keep", sourceNodeId: "video", src: "/api/video-assets/video", start: 0, title: "Keep" },
                { end: 2, id: "drop", sourceNodeId: "video", src: "https://signed.example/video.mp4", start: 0, title: "Drop" },
              ],
            },
            id: "playlist",
            type: "playlist",
          },
        ],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(saved.ok()).toBeTruthy();
    const document = await (await request.get(`/api/canvas/${canvasId}`)).json();
    expect(document.nodes).toEqual([
      {
        data: {
          assetId: "asset-image-1",
          imageSrc: "/api/assets/asset-image-1",
          inputState: "ready",
        },
        id: "image",
        type: "image",
      },
      {
        data: {
          inputState: "invalid",
          inputStateReason: "旧本地预览已失效，请重新上传原视频",
        },
        id: "video",
        type: "video",
      },
      {
        data: {
          inputState: "invalid",
          inputStateReason: "音频上传已中断，请重新上传原音频",
        },
        id: "audio",
        type: "audio",
      },
      {
        data: {
          playlistClips: [
            { end: 2, id: "keep", sourceNodeId: "video", src: "/api/video-assets/video", start: 0, title: "Keep" },
          ],
        },
        id: "playlist",
        type: "playlist",
      },
    ]);
    expect(JSON.stringify(document.nodes)).not.toMatch(
      /(?:blob:|data:|https?:\/\/)/i,
    );
  } finally {
    await request.delete(`/api/canvas/${canvasId}`);
  }
});
