import { beforeEach, describe, expect, it, vi } from "vitest";
import { articleImageSku } from "./article-image-source";

const mocks = vi.hoisted(() => ({ query: vi.fn(), images: vi.fn() }));
vi.mock("./db.server", () => ({
  withDbSession: async (fn: (session: { query: typeof mocks.query }) => unknown) => fn({ query: mocks.query }),
}));
vi.mock("./mawa-api.server", () => ({ listArticleImages: mocks.images }));
import { listShopArticleImages } from "./article-image-source.server";

beforeEach(() => vi.resetAllMocks());

describe("marked article photo sources", () => {
  it.each(["BW - 101-430-001", "BW-101-430-001", " BW -101-430-001 "])(
    "resolves BW prefix in %s", (sku) => expect(articleImageSku(sku)).toBe("101-430-001"),
  );
  it.each(["SA - 101-430-001", "SA-101-430-001", "sa - 101-430-001"])(
    "resolves SA prefix in %s", (sku) => expect(articleImageSku(sku)).toBe("101-430-001"),
  );
  it("keeps ordinary and unrelated article numbers unchanged", () => {
    expect(articleImageSku("101-430-001")).toBe("101-430-001");
    expect(articleImageSku("VO - 101-430-001")).toBe("VO - 101-430-001");
  });
  it("shares all original photos and thumbnails under both marked IDs", async () => {
    mocks.query.mockResolvedValueOnce([
      { id: "bw", sku: "BW - 101-430-001" }, { id: "sa", sku: "SA - 101-430-001" },
    ]).mockResolvedValueOnce([{ id: "original", sku: "101-430-001" }]);
    const photos = [{ id: "photo1" }, { id: "photo2" }, { id: "thumb", isThumbnail: true }];
    mocks.images.mockResolvedValue({ original: photos });
    expect(await listShopArticleImages(["bw", "sa", "original"])).toEqual({ bw: photos, sa: photos, original: photos });
    expect(mocks.images).toHaveBeenCalledWith(["original"]);
    expect(mocks.query.mock.calls[1]?.[1]).toEqual([["101-430-001"]]);
  });
  it("preserves the own photo source when the normal article does not exist", async () => {
    mocks.query.mockResolvedValueOnce([{ id: "bw", sku: "BW - 101-430-001" }]).mockResolvedValueOnce([]);
    mocks.images.mockResolvedValue({ bw: [{ id: "own" }] });
    expect(await listShopArticleImages(["bw"])).toEqual({ bw: [{ id: "own" }] });
  });
  it("keeps normal article photos unchanged", async () => {
    mocks.query.mockResolvedValueOnce([]);
    mocks.images.mockResolvedValue({ normal: [{ id: "photo" }] });
    expect(await listShopArticleImages(["normal"])).toEqual({ normal: [{ id: "photo" }] });
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
});