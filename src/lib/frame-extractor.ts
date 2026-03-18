/**
 * Extracts key frames from a video blob at regular intervals.
 * Uses an offscreen <video> + <canvas> to capture screenshots of slides.
 */

import { resolveLoadedVideoDuration, seekVideo } from "@/lib/video-duration";

export interface ExtractedFrame {
  timestamp: number; // seconds
  blob: Blob;
  dataUrl: string;
}

export interface ProgressInfo {
  phase: "loading" | "extracting" | "uploading";
  current: number;
  total: number;
  percent: number;
}

export type ProgressCallback = (info: ProgressInfo) => void;

export async function extractFrames(
  videoBlob: Blob,
  intervalSeconds = 30,
  maxFrames = 30,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<ExtractedFrame[]> {
  const url = URL.createObjectURL(videoBlob);

  try {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    video.src = url;

    onProgress?.({ phase: "loading", current: 0, total: 1, percent: 0 });

    await waitForMetadata(video, signal);

    if (signal?.aborted) throw new DOMException("Anulowano", "AbortError");

    onProgress?.({ phase: "loading", current: 1, total: 1, percent: 100 });

    const duration = await resolveLoadedVideoDuration(video, signal);
    if (!duration || !isFinite(duration)) return [];

    const timestamps = buildTimestamps(duration, intervalSeconds, maxFrames);
    if (timestamps.length === 0) return [];

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Nie udało się utworzyć kontekstu canvas");

    const frames: ExtractedFrame[] = [];
    let prevHash = "";

    for (let i = 0; i < timestamps.length; i++) {
      if (signal?.aborted) throw new DOMException("Anulowano", "AbortError");

      const ts = timestamps[i];
      onProgress?.({
        phase: "extracting",
        current: i + 1,
        total: timestamps.length,
        percent: Math.round(((i + 1) / timestamps.length) * 100),
      });

      await seekVideo(video, ts, signal);

      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const sample = ctx.getImageData(
        Math.floor(canvas.width / 4),
        Math.floor(canvas.height / 4),
        Math.max(1, Math.min(100, canvas.width)),
        Math.max(1, Math.min(100, canvas.height)),
      );
      const hash = quickHash(sample.data);

      if (hash === prevHash) continue;
      prevHash = hash;

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => {
            if (result) resolve(result);
            else reject(new Error("Nie udało się zapisać klatki"));
          },
          "image/jpeg",
          0.75,
        );
      });
      const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
      frames.push({ timestamp: ts, blob, dataUrl });
    }

    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function waitForMetadata(video: HTMLVideoElement, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error("Video load timeout")); }, 30_000);
    const onAbort = () => { cleanup(); reject(new DOMException("Anulowano", "AbortError")); };
    const onLoaded = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("Failed to load video")); };
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function buildTimestamps(duration: number, intervalSeconds: number, maxFrames: number): number[] {
  const safeDuration = Math.max(duration, 0.1);
  const lastAllowed = Math.max(0, safeDuration - 0.1);
  const timestamps: number[] = [];

  const pushUnique = (value: number) => {
    const clamped = Math.min(Math.max(value, 0), lastAllowed);
    if (timestamps.some((existing) => Math.abs(existing - clamped) < 0.25)) return;
    timestamps.push(clamped);
  };

  if (safeDuration <= 10) {
    pushUnique(safeDuration / 2);
    return timestamps;
  }

  for (let t = 5; t < safeDuration && timestamps.length < maxFrames; t += intervalSeconds) {
    pushUnique(t);
  }

  if (timestamps.length === 0) {
    pushUnique(Math.min(5, safeDuration / 2));
  }

  if (timestamps.length < maxFrames && safeDuration > 10) {
    pushUnique(safeDuration - 5);
  }

  return timestamps.sort((a, b) => a - b).slice(0, maxFrames);
}

function quickHash(data: Uint8ClampedArray): string {
  let hash = 0;
  for (let i = 0; i < data.length; i += 40) {
    hash = ((hash << 5) - hash + data[i]) | 0;
  }
  return hash.toString(36);
}

export async function uploadFrames(
  supabase: any,
  userId: string,
  recordingStem: string,
  frames: ExtractedFrame[],
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<string[]> {
  const paths: string[] = [];

  for (let i = 0; i < frames.length; i++) {
    if (signal?.aborted) throw new DOMException("Anulowano", "AbortError");

    onProgress?.({
      phase: "uploading",
      current: i + 1,
      total: frames.length,
      percent: Math.round(((i + 1) / frames.length) * 100),
    });

    const secs = Math.round(frames[i].timestamp);
    const path = `${userId}/frames/${recordingStem}/frame_${secs}s.jpg`;
    const { error } = await supabase.storage
      .from("recordings")
      .upload(path, frames[i].blob, {
        contentType: "image/jpeg",
        upsert: true,
      });
    if (!error) paths.push(path);
  }

  return paths;
}
