import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HILLTOP_VAST_TAG_URL, HilltopVideoAd } from "@/components/HilltopVideoAd";

const MEDIA_720 = "https://cdn.example/ad-720.mp4";
const MEDIA_480 = "https://cdn.example/ad-480.mp4";
const INLINE_URL = "https://ads.example/inline.xml";

const VAST_INLINE = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0" xmlns="http://www.w3.org/2001/XMLSchema">
  <Ad id="567601">
    <InLine>
      <AdSystem version="3.0">HilltopAds</AdSystem>
      <Impression><![CDATA[https://tracker.example/impression]]></Impression>
      <Creatives>
        <Creative>
          <Linear skipoffset="00:00:15">
            <Duration>00:00:14</Duration>
            <MediaFiles>
              <MediaFile delivery="progressive" type="video/mp4" bitrate="545" width="1280" height="720"><![CDATA[${MEDIA_720}]]></MediaFile>
              <MediaFile delivery="progressive" type="video/mp4" bitrate="329" width="854" height="480"><![CDATA[${MEDIA_480}]]></MediaFile>
            </MediaFiles>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>`;

const VAST_WRAPPER = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0" xmlns="http://www.w3.org/2001/XMLSchema">
  <Ad id="wrapper-1">
    <Wrapper>
      <AdSystem>HilltopAds</AdSystem>
      <VASTAdTagURI><![CDATA[${INLINE_URL}]]></VASTAdTagURI>
      <Impression><![CDATA[https://tracker.example/wrapper-impression]]></Impression>
    </Wrapper>
  </Ad>
</VAST>`;

const VAST_WITHOUT_MEDIA = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0" xmlns="http://www.w3.org/2001/XMLSchema">
  <Ad id="empty">
    <InLine>
      <AdSystem>HilltopAds</AdSystem>
      <Creatives><Creative><Linear><Duration>00:00:14</Duration></Linear></Creative></Creatives>
    </InLine>
  </Ad>
</VAST>`;

function response(body: string) {
  return { ok: true, status: 200, text: async () => body };
}

function stubFetch(...bodies: string[]) {
  const fetchMock = vi.fn();
  bodies.forEach((body) => fetchMock.mockResolvedValueOnce(response(body)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderPlayer(onAdCompleted = vi.fn()) {
  render(<HilltopVideoAd onAdCompleted={onAdCompleted} />);
  const video = await screen.findByTestId("hilltop-video");
  return { onAdCompleted, video: video as HTMLVideoElement };
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockImplementation((type) =>
    type.includes("mp4") ? "probably" : "",
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HilltopVideoAd", () => {
  it("resolves the Hilltop VAST tag into a muted 16:9 inline video", async () => {
    const fetchMock = stubFetch(VAST_INLINE);

    const { onAdCompleted, video } = await renderPlayer();

    expect(fetchMock).toHaveBeenCalledWith(
      HILLTOP_VAST_TAG_URL,
      expect.objectContaining({ credentials: "omit" }),
    );
    expect(video.getAttribute("src")).toBe(MEDIA_720);
    expect(video.muted).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video.getAttribute("playsinline")).not.toBeNull();
    expect(video.hasAttribute("controls")).toBe(false);
    expect(video.parentElement?.className).toContain("aspect-video");
    expect(onAdCompleted).not.toHaveBeenCalled();
  });

  it("fires onAdCompleted only once the ad actually ends", async () => {
    stubFetch(VAST_INLINE);
    const { onAdCompleted, video } = await renderPlayer();

    fireEvent.playing(video);
    expect(onAdCompleted).not.toHaveBeenCalled();

    fireEvent.timeUpdate(video);
    expect(onAdCompleted).not.toHaveBeenCalled();

    fireEvent.ended(video);
    expect(onAdCompleted).toHaveBeenCalledTimes(1);

    // A duplicated event must not pay the reward twice.
    fireEvent.ended(video);
    expect(onAdCompleted).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Video ad complete")).toBeInTheDocument();
  });

  it("treats reaching the reported duration as completion when `ended` is dropped", async () => {
    stubFetch(VAST_INLINE);
    const { onAdCompleted, video } = await renderPlayer();

    Object.defineProperty(video, "duration", { configurable: true, value: 14 });
    Object.defineProperty(video, "currentTime", { configurable: true, writable: true, value: 9 });

    fireEvent.timeUpdate(video);
    expect(onAdCompleted).not.toHaveBeenCalled();

    video.currentTime = 14;
    fireEvent.timeUpdate(video);
    expect(onAdCompleted).toHaveBeenCalledTimes(1);
  });

  it("follows a VAST wrapper to the inline creative", async () => {
    const fetchMock = stubFetch(VAST_WRAPPER, VAST_INLINE);

    const { video } = await renderPlayer();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, HILLTOP_VAST_TAG_URL, expect.anything());
    expect(fetchMock).toHaveBeenNthCalledWith(2, INLINE_URL, expect.anything());
    expect(video.getAttribute("src")).toBe(MEDIA_720);
  });

  it("fails closed when the VAST request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);

    const onAdCompleted = vi.fn();
    render(<HilltopVideoAd onAdCompleted={onAdCompleted} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/video ad request failed \(503\)/i);
    expect(onAdCompleted).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry video ad" })).toBeInTheDocument();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("fails closed when the response has no playable media", async () => {
    stubFetch(VAST_WITHOUT_MEDIA);

    const onAdCompleted = vi.fn();
    render(<HilltopVideoAd onAdCompleted={onAdCompleted} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no playable media/i);
    expect(onAdCompleted).not.toHaveBeenCalled();
  });

  it("fails closed when the media itself errors", async () => {
    stubFetch(VAST_INLINE);
    const { onAdCompleted, video } = await renderPlayer();

    fireEvent.error(video);

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't play/i);
    expect(onAdCompleted).not.toHaveBeenCalled();
  });
});
