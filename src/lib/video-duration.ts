/**
 * Resolves the real duration of a video Blob, handling WebM files
 * from MediaRecorder that often report Infinity as duration.
 *
 * Uses the seek-to-end trick: setting currentTime to a huge value
 * forces the browser to discover the actual end of the stream.
 */

export async function getVideoDuration(
  blob: Blob,
  signal?: AbortSignal,
): Promise<number> {
  const url = URL.createObjectURL(blob);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    video.src = url;

    // 1. Wait for metadata
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

    // 2. If duration is already valid, return it
    if (isFinite(video.duration) && video.duration > 0) {
      return video.duration;
    }

    // 3. Seek-to-end trick for WebM with unknown duration
    await seekVideo(video, Number.MAX_SAFE_INTEGER, signal, 5_000);
    const fixedDuration = video.duration;
    // Seek back to start so GC can clean up properly
    await seekVideo(video, 0, signal, 3_000).catch(() => undefined);

    if (isFinite(fixedDuration) && fixedDuration > 0) {
      return fixedDuration;
    }

    // 4. Last resort: estimate from file size (~500 KB/s for screen recording WebM)
    const estimated = blob.size / (500 * 1024);
    return Math.max(estimated, 10);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Same as getVideoDuration but works with an already-loaded HTMLVideoElement
 * (does not create/destroy its own element).
 */
export async function resolveLoadedVideoDuration(
  video: HTMLVideoElement,
  signal?: AbortSignal,
): Promise<number | null> {
  if (isFinite(video.duration) && video.duration > 0) return video.duration;

  try {
    await seekVideo(video, Number.MAX_SAFE_INTEGER, signal, 5_000);
    const fixedDuration = video.duration;
    await seekVideo(video, 0, signal, 3_000).catch(() => undefined);
    if (isFinite(fixedDuration) && fixedDuration > 0) return fixedDuration;
  } catch {
    // ignore
  }

  return null;
}

export async function seekVideo(
  video: HTMLVideoElement,
  time: number,
  signal?: AbortSignal,
  timeoutMs = 4_000,
): Promise<void> {
  if (signal?.aborted) throw new DOMException("Anulowano", "AbortError");

  const targetTime = Math.max(0, Number.isFinite(time) ? time : 0);

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => { cleanup(); resolve(); }, timeoutMs);
    const onAbort = () => { cleanup(); reject(new DOMException("Anulowano", "AbortError")); };
    const onSeeked = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("Błąd przewijania wideo")); };
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    video.currentTime = targetTime;
  });
}
