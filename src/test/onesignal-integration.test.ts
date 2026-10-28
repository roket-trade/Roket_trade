import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The SDK is mocked so these tests can assert the *contract* the app relies on:
 * the exact init options, a single init per page load, and the identity sync
 * that maps a Supabase user onto an OneSignal external id.
 */
const { mockInit, mockLogin, mockLogout, mockRequestPermission, mockUser } = vi.hoisted(() => {
  const user = { externalId: undefined as string | undefined };
  return {
    mockInit: vi.fn(() => Promise.resolve()),
    mockLogin: vi.fn((externalId: string) => {
      user.externalId = externalId;
      return Promise.resolve();
    }),
    mockLogout: vi.fn(() => {
      user.externalId = undefined;
      return Promise.resolve();
    }),
    mockRequestPermission: vi.fn(() => Promise.resolve(true)),
    mockUser: user,
  };
});

vi.mock("react-onesignal", () => ({
  default: {
    init: mockInit,
    login: mockLogin,
    logout: mockLogout,
    Notifications: { requestPermission: mockRequestPermission },
    User: {
      get externalId() {
        return mockUser.externalId;
      },
      PushSubscription: { id: "sub-1", token: "token-1", optedIn: true },
    },
  },
}));

type OneSignalModule = typeof import("@/lib/onesignal");

async function loadModule(): Promise<OneSignalModule> {
  // Fresh module per test: the init promise and linked-user id are memoised.
  vi.resetModules();
  return import("@/lib/onesignal");
}

describe("OneSignal integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom has no service worker registry; the integration requires one.
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {},
    });
  });

  it("initializes once with the app id, worker scope and worker path", async () => {
    const { initOneSignal, ONESIGNAL_APP_ID } = await loadModule();

    await initOneSignal();
    await initOneSignal();

    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockInit).toHaveBeenCalledWith({
      appId: "2211a014-e833-4ec6-a9b5-c9de8c0f50de",
      serviceWorkerParam: { scope: "/onesignal/" },
      serviceWorkerPath: "/onesignal/OneSignalSDKWorker.js",
      allowLocalhostAsSecureOrigin: true,
    });
    expect(ONESIGNAL_APP_ID).toBe("2211a014-e833-4ec6-a9b5-c9de8c0f50de");
  });

  it("links the Supabase user id as the OneSignal identity", async () => {
    const { syncOneSignalUser } = await loadModule();

    await syncOneSignalUser("11111111-2222-3333-4444-555555555555");

    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockLogin).toHaveBeenCalledWith("11111111-2222-3333-4444-555555555555");
  });

  it("confirms the external id is attached after login", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { syncOneSignalUser } = await loadModule();

    await syncOneSignalUser("user-42");

    expect(mockUser.externalId).toBe("user-42");
    expect(log).toHaveBeenCalledWith(
      "[OneSignal] linked user",
      expect.objectContaining({
        expectedExternalId: "user-42",
        externalId: "user-42",
      }),
    );
    log.mockRestore();
  });

  it("does not re-login for the same user across renders", async () => {
    const { syncOneSignalUser } = await loadModule();

    await syncOneSignalUser("user-1");
    await syncOneSignalUser("user-1");

    expect(mockLogin).toHaveBeenCalledTimes(1);
  });

  it("logs out when the session ends", async () => {
    const { syncOneSignalUser } = await loadModule();

    await syncOneSignalUser("user-1");
    await syncOneSignalUser(null);

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it("does not log out an anonymous first-time visitor", async () => {
    const { syncOneSignalUser } = await loadModule();

    await syncOneSignalUser(null);

    expect(mockLogout).not.toHaveBeenCalled();
  });

  it("requests permission through the SDK", async () => {
    const { requestPushPermission } = await loadModule();

    await expect(requestPushPermission()).resolves.toBe(true);
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  });

  it("treats a failed permission request as not granted", async () => {
    mockRequestPermission.mockRejectedValueOnce(new Error("blocked"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { requestPushPermission } = await loadModule();

    await expect(requestPushPermission()).resolves.toBe(false);
    warn.mockRestore();
  });

  it("survives an init failure without throwing", async () => {
    mockInit.mockRejectedValueOnce(new Error("no push support"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { initOneSignal, syncOneSignalUser } = await loadModule();

    await expect(initOneSignal()).resolves.toBeUndefined();
    await expect(syncOneSignalUser("user-1")).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
