import { useCallback, useEffect, useRef, useState } from "react";

// HilltopAds video ad (VAST 3.0).
// The tag answers with a single InLine ad whose MediaFiles are progressive
// MP4/WebM, so we resolve it in the browser and play it with a native <video>.
// Nothing here fabricates a completion: `onAdCompleted` only fires once the
// media has actually reached its end.
export const HILLTOP_VAST_TAG_URL =
  "https://enchantingboss.com/dgmzF/z_d.GTNJvSZQGNUn/Ye/mk9muaZ/UQl/kfPZTxcc1aMYzdk-0PNKzGMvtDNBznUZzWO/TrQR3/NRwB";

// A wrapper tag points at another VAST document. Three hops is plenty for any
// real network and keeps a broken chain from looping forever.
const MAX_WRAPPER_DEPTH = 3;
// `ended` occasionally never fires when the last frame is dropped; treat
// "within a quarter second of the reported duration" as the end as well.
const COMPLETION_EPSILON_SECONDS = 0.25;
// If neither the VAST response nor the media shows up in this window we fail
// closed — the reward stays locked rather than unlocking on a broken ad.
const LOAD_TIMEOUT_MS = 20000;
// VAST error 402 ("media timeout"): the creative got a source but never began
// loading. Eight seconds is long enough for a cold CDN and short enough that a
// blocked request surfaces as a retry instead of an endless spinner.
const MEDIA_START_TIMEOUT_MS = 8000;
// MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED — the browser cannot decode the file.
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

// Proxy fallback: some ad networks reject browser requests to their media CDNs
// (no Access-Control-Allow-Origin, hotlink blocking or bot filtering), which
// surfaces as net::ERR_FAILED even though the VAST XML itself loads fine.
// There is no client-side workaround — such media must be fetched by a
// server-side proxy on our own origin and played from there. The error UI
// surfaces that hint whenever a network/media failure keeps the reward locked.

type AdStatus = "loading" | "playing" | "completed" | "error";

type MediaFile = {
  url: string;
  type: string;
  bitrate: number;
  height: number;
};

type VastPayload = {
  mediaFiles: MediaFile[];
  impressionUrls: string[];
  errorUrl: string | null;
};

export type HilltopVideoAdProps = {
  onAdCompleted?: () => void;
};

/** Namespace-agnostic element lookup (VAST documents use a default xmlns). */
function elementsByLocalName(root: Document | Element, localName: string): Element[] {
  const found: Element[] = [];
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i += 1) {
    const node = all[i];
    if (node && node.localName === localName) found.push(node);
  }
  return found;
}

function textOf(element: Element | null | undefined): string {
  return (element?.textContent ?? "").trim();
}

function parseMediaFiles(root: Element): MediaFile[] {
  return elementsByLocalName(root, "MediaFile")
    .map((element) => {
      const type = (element.getAttribute("type") ?? "").trim().toLowerCase();
      return {
        url: textOf(element),
        type,
        bitrate: Number(element.getAttribute("bitrate") ?? 0) || 0,
        height: Number(element.getAttribute("height") ?? 0) || 0,
      };
    })
    .filter(
      (file) =>
        file.url.length > 0 &&
        /^https?:\/\//i.test(file.url) &&
        (file.type === "" || file.type.startsWith("video/")),
    );
}

function sortMediaFiles(files: MediaFile[]): MediaFile[] {
  return [...files].sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
}

/**
 * Ask the browser whether it can decode a MIME type. A missing type means "let
 * the media element try it" — VAST responses in the wild often omit `type`
 * while serving a plain MP4.
 */
function isTypeSupported(type: string): boolean {
  if (!type) return true;
  if (typeof document === "undefined") return true;
  const probe = document.createElement("video");
  if (typeof probe.canPlayType !== "function") return type === "video/mp4";
  return probe.canPlayType(type) !== "";
}

async function fetchVastDocument(url: string): Promise<Document> {
  const response = await fetch(url, { cache: "no-store", credentials: "omit" });
  if (!response.ok) {
    throw new Error(`The video ad request failed (${response.status}).`);
  }

  const xml = await response.text();
  const document = new DOMParser().parseFromString(xml, "text/xml");
  if (elementsByLocalName(document, "parsererror").length > 0) {
    throw new Error("The video ad returned malformed VAST XML.");
  }
  if (elementsByLocalName(document, "VAST").length === 0) {
    throw new Error("The video ad returned an unexpected response.");
  }
  return document;
}

async function loadVast(url: string, depth = 0): Promise<VastPayload> {
  const document = await fetchVastDocument(url);
  const ad = elementsByLocalName(document, "Ad")[0];
  if (!ad) throw new Error("No video ad is available right now.");

  const impressionUrls = elementsByLocalName(ad, "Impression")
    .map((element) => textOf(element))
    .filter(Boolean);
  const errorUrl = textOf(elementsByLocalName(ad, "Error")[0]) || null;

  const inline = elementsByLocalName(ad, "InLine")[0];
  if (inline) {
    const mediaFiles = parseMediaFiles(inline);
    if (mediaFiles.length === 0) {
      throw new Error("The video ad has no playable media file.");
    }
    return { mediaFiles, impressionUrls, errorUrl };
  }

  const wrapper = elementsByLocalName(ad, "Wrapper")[0];
  if (wrapper) {
    if (depth >= MAX_WRAPPER_DEPTH) {
      throw new Error("The video ad wrapper chain is too deep.");
    }
    const nestedTag = textOf(elementsByLocalName(wrapper, "VASTAdTagURI")[0]);
    if (!nestedTag) throw new Error("The video ad wrapper is missing its VAST tag URL.");

    const nested = await loadVast(nestedTag, depth + 1);
    return {
      mediaFiles: nested.mediaFiles,
      impressionUrls: [...impressionUrls, ...nested.impressionUrls],
      errorUrl: nested.errorUrl ?? errorUrl,
    };
  }

  throw new Error("The video ad response contained no creative.");
}

/** Fire an impression pixel without blocking playback. */
function firePixel(url: string) {
  if (!url) return;
  try {
    const image = new Image();
    image.referrerPolicy = "no-referrer-when-downgrade";
    image.src = url;
  } catch {
    // Tracking must never break the ad.
  }
}

export function HilltopVideoAd({ onAdCompleted }: HilltopVideoAdProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const completedRef = useRef(false);
  const impressionsSentRef = useRef(false);
  const mediaStartedRef = useRef(false);
  const onAdCompletedRef = useRef(onAdCompleted);

  const [status, setStatus] = useState<AdStatus>("loading");
  const [candidates, setCandidates] = useState<MediaFile[]>([]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [impressionUrls, setImpressionUrls] = useState<string[]>([]);
  const [needsInteraction, setNeedsInteraction] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [proxyHint, setProxyHint] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const currentMedia = candidates[candidateIndex] ?? null;

  useEffect(() => {
    onAdCompletedRef.current = onAdCompleted;
  }, [onAdCompleted]);

  const finish = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    setStatus("completed");
    setNeedsInteraction(false);
    onAdCompletedRef.current?.();
  }, []);

  // Load + resolve the VAST tag. A failed request parks the player in the
  // error state, which keeps the caller's reward gate closed.
  useEffect(() => {
    let cancelled = false;
    completedRef.current = false;
    impressionsSentRef.current = false;
    mediaStartedRef.current = false;
    setStatus("loading");
    setCandidates([]);
    setCandidateIndex(0);
    setImpressionUrls([]);
    setErrorMessage("");
    setProxyHint(false);
    setNeedsInteraction(false);

    (async () => {
      try {
        const payload = await loadVast(HILLTOP_VAST_TAG_URL);
        if (cancelled) return;

        // Keep every format the browser says it can decode, best first. If
        // none qualify we stop before requesting a file we know will fail.
        const supported = sortMediaFiles(payload.mediaFiles).filter((file) =>
          isTypeSupported(file.type),
        );
        if (supported.length === 0) {
          throw new Error("Ad format not supported.");
        }

        setImpressionUrls(payload.impressionUrls);
        setCandidates(supported);
        setCandidateIndex(0);
      } catch (error) {
        if (cancelled) return;
        setStatus("error");
        setProxyHint(false);
        setErrorMessage(error instanceof Error ? error.message : "The video ad couldn't load.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Attach the chosen MediaFile ourselves so `crossOrigin` is set *before* the
  // request starts. The attribute is ignored once `src` exists, which is
  // exactly how a CORS-enabled CDN request turns into net::ERR_FAILED.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentMedia) return;

    mediaStartedRef.current = false;
    video.crossOrigin = "anonymous";
    video.src = currentMedia.url;
    video.load();
  }, [currentMedia, attempt]);

  // VAST 402-style watchdog: a source that never starts loading must not leave
  // the modal spinning forever. This keeps the reward gate closed and offers
  // Retry instead.
  useEffect(() => {
    if (!currentMedia) return;
    const timer = setTimeout(() => {
      if (mediaStartedRef.current || completedRef.current) return;
      console.error("[HilltopVideoAd] media did not start within 8s", {
        src: currentMedia.url,
        type: currentMedia.type,
      });
      setStatus("error");
      setProxyHint(true);
      setNeedsInteraction(false);
      setErrorMessage("The video ad took too long to load.");
    }, MEDIA_START_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [currentMedia, attempt]);

  // Fail closed if the VAST document itself never arrives.
  useEffect(() => {
    if (status !== "loading" || candidates.length > 0) return;
    const timer = setTimeout(() => {
      setStatus("error");
      setProxyHint(false);
      setErrorMessage("The video ad timed out. Please retry.");
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status, candidates.length, attempt]);

  const markMediaStarted = useCallback(() => {
    mediaStartedRef.current = true;
  }, []);

  const startPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video || completedRef.current) return;
    mediaStartedRef.current = true;
    // Keep the muted property in sync with the attribute; several browsers
    // only allow autoplay on a programmatically muted element.
    video.muted = true;

    const playback = video.play?.();
    if (playback && typeof playback.catch === "function") {
      playback.then(() => setNeedsInteraction(false)).catch(() => setNeedsInteraction(true));
    }
  }, []);

  const handlePlaying = useCallback(() => {
    mediaStartedRef.current = true;
    setStatus((current) => (current === "completed" ? current : "playing"));
    setNeedsInteraction(false);

    if (!impressionsSentRef.current) {
      impressionsSentRef.current = true;
      impressionUrls.forEach(firePixel);
    }
  }, [impressionUrls]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || completedRef.current) return;
    const { duration, currentTime } = video;
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (currentTime >= duration - COMPLETION_EPSILON_SECONDS) finish();
  }, [finish]);

  const handleError = useCallback(() => {
    if (completedRef.current) return;
    // The element reacted, so the 8s watchdog is no longer relevant.
    mediaStartedRef.current = true;

    const video = videoRef.current;
    const mediaError = video?.error;
    console.error("[HilltopVideoAd] video error", {
      message: mediaError?.message || "(no message)",
      code: mediaError?.code ?? null,
      src: video?.currentSrc || video?.src || currentMedia?.url,
    });

    // Format problem? Fall back to the next <MediaFile> from the VAST
    // response before giving up on the creative.
    const nextIndex = candidateIndex + 1;
    if (nextIndex < candidates.length) {
      setStatus("loading");
      setErrorMessage("");
      setProxyHint(false);
      setCandidateIndex(nextIndex);
      return;
    }

    setStatus("error");
    setNeedsInteraction(false);
    if (mediaError?.code === MEDIA_ERR_SRC_NOT_SUPPORTED) {
      setErrorMessage("Ad format not supported.");
      setProxyHint(false);
    } else {
      setErrorMessage("The video ad failed to load (network error).");
      setProxyHint(true);
    }
  }, [candidates, candidateIndex, currentMedia]);

  const retry = () => setAttempt((current) => current + 1);

  return (
    <div className="w-full overflow-hidden rounded-xl border border-border/60 bg-black">
      <div className="relative aspect-video w-full">
        {currentMedia && (
          <video
            key={currentMedia.url}
            ref={videoRef}
            data-testid="hilltop-video"
            aria-label="Sponsored video ad"
            className="h-full w-full object-contain"
            crossOrigin="anonymous"
            autoPlay
            muted
            playsInline
            preload="auto"
            controls={false}
            onLoadedMetadata={markMediaStarted}
            onCanPlay={startPlayback}
            onLoadedData={startPlayback}
            onPlaying={handlePlaying}
            onTimeUpdate={handleTimeUpdate}
            onEnded={finish}
            onError={handleError}
          />
        )}

        {status === "loading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 text-xs text-white/80">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            <p>Loading video ad…</p>
          </div>
        )}

        {needsInteraction && status !== "error" && status !== "completed" && (
          <button
            type="button"
            onClick={startPlayback}
            className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm font-semibold text-white"
          >
            Tap to play video ad
          </button>
        )}

        {status === "completed" && (
          <div className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-emerald-500/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-black">
            Video ad complete
          </div>
        )}

        {status === "error" && (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 px-4 text-center text-xs text-white/85"
          >
            <p>{errorMessage || "The video ad couldn't load."}</p>
            {proxyHint && (
              <p className="text-[10px] leading-relaxed text-white/50">
                Some ad networks block direct browser playback. If this keeps happening, the ad
                media needs to be served through a server-side proxy.
              </p>
            )}
            <button
              type="button"
              onClick={retry}
              className="rounded-md border border-white/40 px-3 py-1.5 font-semibold text-white transition-colors hover:bg-white/10"
            >
              Retry video ad
            </button>
          </div>
        )}
      </div>
      {status !== "completed" && (
        <p className="bg-black px-3 py-2 text-center text-[10px] uppercase tracking-[0.2em] text-white/50">
          Sponsored video · muted
        </p>
      )}
    </div>
  );
}
