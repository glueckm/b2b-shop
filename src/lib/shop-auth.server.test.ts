import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCookie: vi.fn(), deleteCookie: vi.fn(), setCookie: vi.fn(), logEvent: vi.fn(),
}));
vi.mock("@tanstack/react-start/server", () => mocks);
vi.mock("./db.server", () => ({ logEvent: mocks.logEvent }));
import { apiCurrentUser } from "./shop-auth.server";

const account = { id: "test-account", email: "", customer_number: "test-customer" };
const cacheRef = globalThis as typeof globalThis & {
  __mawaShopUserCache?: Map<string, { at: number; value: unknown }>;
};
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  cacheRef.__mawaShopUserCache = new Map();
  mocks.getCookie.mockImplementation((key: string) => key === "mawa_b2b_shop_token" ? "test-token" : undefined);
  vi.stubEnv("USER_API_BASE_URL", "https://example.invalid");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("existing customer session checks", () => {
  it("retries a timeout once and returns the signed-in account", async () => {
    const error = new DOMException("Timed out", "TimeoutError");
    fetchMock.mockRejectedValueOnce(error).mockResolvedValueOnce(Response.json(account));
    expect(await apiCurrentUser()).toMatchObject({ id: "test-account" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.logEvent).toHaveBeenCalledWith("warn", "auth.me_failed", expect.objectContaining({
      ms: expect.any(Number), attempt: 1, retry: true,
    }), error);
    expect(mocks.deleteCookie).not.toHaveBeenCalled();
  });

  it("throws rather than returning a guest after two failed checks", async () => {
    fetchMock.mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
    await expect(apiCurrentUser()).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.logEvent).toHaveBeenCalledTimes(2);
    expect(mocks.logEvent).toHaveBeenLastCalledWith("error", "auth.me_failed", expect.objectContaining({
      ms: expect.any(Number), attempt: 2, retry: false,
    }), expect.any(DOMException));
    expect(mocks.deleteCookie).not.toHaveBeenCalled();
  });

  it("logs out only on a real 401 and clears the expired cached identity", async () => {
    cacheRef.__mawaShopUserCache?.set("test-token", { at: 0, value: account });
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    expect(await apiCurrentUser()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cacheRef.__mawaShopUserCache?.has("test-token")).toBe(false);
    expect(mocks.deleteCookie).toHaveBeenCalledWith("mawa_b2b_shop_token", expect.any(Object));
  });

  it.each([403, 429, 500, 503])("does not log out on HTTP %s", async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    await expect(apiCurrentUser()).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.logEvent).toHaveBeenCalledWith("error", "auth.me_failed", expect.objectContaining({ status }), expect.any(Error));
    expect(mocks.deleteCookie).not.toHaveBeenCalled();
  });

  it("returns null without an API call when no session cookie exists", async () => {
    mocks.getCookie.mockReturnValue(undefined);
    expect(await apiCurrentUser()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a fresh cached account without a network check", async () => {
    fetchMock.mockResolvedValue(Response.json(account));
    const first = await apiCurrentUser();
    expect(await apiCurrentUser()).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});