import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequestPushPermission, mockGetPushPermission } = vi.hoisted(() => ({
  mockRequestPushPermission: vi.fn(() => Promise.resolve(true)),
  mockGetPushPermission: vi.fn<() => NotificationPermission | "unsupported">(() => "default"),
}));

vi.mock("@/lib/onesignal", () => ({
  getPushPermission: () => mockGetPushPermission(),
  isPushPermissionGranted: () => mockGetPushPermission() === "granted",
  isPushPermissionDenied: () => mockGetPushPermission() === "denied",
  requestPushPermission: () => mockRequestPushPermission(),
}));

import { NotificationBanner } from "@/components/NotificationBanner";

const PROMPT = "Enable push notifications to get instant updates on your deposits and withdrawals.";

describe("NotificationBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPushPermission.mockReturnValue("default");
    mockRequestPushPermission.mockResolvedValue(true);
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("asks the user to allow push when permission is undecided", () => {
    render(<NotificationBanner />);

    expect(screen.getByText(PROMPT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow" })).toBeInTheDocument();
  });

  it("stays hidden once permission is already granted", () => {
    mockGetPushPermission.mockReturnValue("granted");

    render(<NotificationBanner />);

    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
  });

  it("stays hidden when permission was denied, since browsers ignore re-prompts", () => {
    mockGetPushPermission.mockReturnValue("denied");

    render(<NotificationBanner />);

    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
  });

  it("stays hidden when the browser cannot show notifications at all", () => {
    mockGetPushPermission.mockReturnValue("unsupported");

    render(<NotificationBanner />);

    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
  });

  it("requests permission on Allow and confirms when it is granted", async () => {
    render(<NotificationBanner />);

    fireEvent.click(screen.getByRole("button", { name: "Allow" }));

    await waitFor(() => expect(mockRequestPushPermission).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Push notifications are on/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
  });

  it("hides itself when the user declines the prompt", async () => {
    mockRequestPushPermission.mockResolvedValue(false);

    render(<NotificationBanner />);

    fireEvent.click(screen.getByRole("button", { name: "Allow" }));

    await waitFor(() => expect(screen.queryByText(PROMPT)).not.toBeInTheDocument());
  });

  it("remembers a dismissal so it does not nag on every visit", () => {
    const { unmount } = render(<NotificationBanner />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification prompt" }));

    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
    expect(window.localStorage.getItem("roket:push-banner-dismissed")).toBe("1");

    unmount();
    render(<NotificationBanner />);
    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
  });
});
