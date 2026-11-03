import type {
  ImageUploadTicket,
  MaxImageBytes,
  StorePhotoRegisterRequest,
} from "@repo/api-contracts";

import {
  resolveImageContentType,
  uploadStorePhotos,
  type LocalImage,
  type UploadStorePhotosDeps,
} from "@/src/features/auth/application/use-cases/upload-store-photos.use-case";

const STORE_ID = "11111111-1111-4111-8111-111111111111";
/** Restated as a value because the contracts package is ESM-only; see the use case. */
const MAX_IMAGE_BYTES: MaxImageBytes = 5_242_880;

function bytes(length: number) {
  return new Uint8Array(length);
}

type Recorded = {
  tickets: { storeId: string; contentType: string; contentLength: number }[];
  uploads: { objectKey: string; byteLength: number }[];
  registered: { storeId: string; request: StorePhotoRegisterRequest }[];
};

function createDeps(
  images: Record<string, LocalImage | null>,
  overrides: Partial<UploadStorePhotosDeps> = {},
) {
  const recorded: Recorded = { tickets: [], uploads: [], registered: [] };
  let ticketSequence = 0;

  const deps: UploadStorePhotosDeps = {
    async readLocalImage(uri) {
      return images[uri] ?? null;
    },
    async requestUploadTicket(storeId, request) {
      recorded.tickets.push({ storeId, ...request });
      ticketSequence += 1;
      return {
        objectKey: `stores/${storeId}/object-${ticketSequence}.jpg`,
        uploadUrl: `https://garage.test/upload/${ticketSequence}`,
        contentType: request.contentType,
        contentLength: request.contentLength,
        expiresInSeconds: 900,
      } satisfies ImageUploadTicket;
    },
    async uploadBytes(ticket, payload) {
      recorded.uploads.push({
        objectKey: ticket.objectKey,
        byteLength: payload.length,
      });
      return true;
    },
    async registerPhoto(storeId, request) {
      recorded.registered.push({ storeId, request });
      return true;
    },
    ...overrides,
  };

  return { deps, recorded };
}

describe("resolveImageContentType", () => {
  it("accepts the three supported image types from a local file extension", () => {
    expect(resolveImageContentType("file:///tmp/a.jpg")).toBe("image/jpeg");
    expect(resolveImageContentType("file:///tmp/a.JPEG")).toBe("image/jpeg");
    expect(resolveImageContentType("file:///tmp/a.png")).toBe("image/png");
    expect(resolveImageContentType("file:///tmp/a.webp")).toBe("image/webp");
  });

  it("ignores a query string and a fragment on the local URI", () => {
    expect(resolveImageContentType("file:///tmp/a.png?width=40")).toBe(
      "image/png",
    );
  });

  it("rejects anything outside the allowlist", () => {
    expect(resolveImageContentType("file:///tmp/a.gif")).toBeNull();
    expect(resolveImageContentType("file:///tmp/a.heic")).toBeNull();
    expect(resolveImageContentType("file:///tmp/a.pdf")).toBeNull();
    expect(resolveImageContentType("file:///tmp/no-extension")).toBeNull();
  });

  it("prefers a reported content type that is in the allowlist", () => {
    expect(resolveImageContentType("file:///tmp/a.bin", "image/webp")).toBe(
      "image/webp",
    );
    expect(
      resolveImageContentType("file:///tmp/a.jpg", "application/octet-stream"),
    ).toBe("image/jpeg");
  });
});

describe("uploadStorePhotos", () => {
  it("presigns, uploads and registers each photo in order", async () => {
    const { deps, recorded } = createDeps({
      "file:///tmp/one.jpg": { bytes: bytes(10), contentType: "image/jpeg" },
      "file:///tmp/two.png": { bytes: bytes(20), contentType: "image/png" },
    });

    const result = await uploadStorePhotos({
      storeId: STORE_ID,
      uris: ["file:///tmp/one.jpg", "file:///tmp/two.png"],
      deps,
    });

    expect(result).toEqual({
      uploaded: ["file:///tmp/one.jpg", "file:///tmp/two.png"],
      failed: [],
    });
    expect(recorded.tickets).toEqual([
      { storeId: STORE_ID, contentType: "image/jpeg", contentLength: 10 },
      { storeId: STORE_ID, contentType: "image/png", contentLength: 20 },
    ]);
    expect(recorded.uploads).toEqual([
      { objectKey: `stores/${STORE_ID}/object-1.jpg`, byteLength: 10 },
      { objectKey: `stores/${STORE_ID}/object-2.jpg`, byteLength: 20 },
    ]);
    expect(recorded.registered).toEqual([
      {
        storeId: STORE_ID,
        request: {
          objectKey: `stores/${STORE_ID}/object-1.jpg`,
          contentType: "image/jpeg",
          byteSize: 10,
        },
      },
      {
        storeId: STORE_ID,
        request: {
          objectKey: `stores/${STORE_ID}/object-2.jpg`,
          contentType: "image/png",
          byteSize: 20,
        },
      },
    ]);
  });

  it("does nothing at all when there are no photos", async () => {
    const { deps, recorded } = createDeps({});

    expect(
      await uploadStorePhotos({ storeId: STORE_ID, uris: [], deps }),
    ).toEqual({ uploaded: [], failed: [] });
    expect(recorded.tickets).toEqual([]);
    expect(recorded.uploads).toEqual([]);
    expect(recorded.registered).toEqual([]);
  });

  it("never asks for a ticket for an unreadable photo", async () => {
    const { deps, recorded } = createDeps({
      "file:///tmp/ok.jpg": { bytes: bytes(10), contentType: "image/jpeg" },
      "file:///tmp/gone.jpg": null,
    });

    const result = await uploadStorePhotos({
      storeId: STORE_ID,
      uris: ["file:///tmp/gone.jpg", "file:///tmp/ok.jpg"],
      deps,
    });

    expect(result).toEqual({
      uploaded: ["file:///tmp/ok.jpg"],
      failed: ["file:///tmp/gone.jpg"],
    });
    expect(recorded.tickets).toHaveLength(1);
  });

  it("never asks for a ticket for an empty or oversized photo", async () => {
    const { deps, recorded } = createDeps({
      "file:///tmp/empty.jpg": { bytes: bytes(0), contentType: "image/jpeg" },
      "file:///tmp/huge.jpg": {
        bytes: bytes(MAX_IMAGE_BYTES + 1),
        contentType: "image/jpeg",
      },
    });

    const result = await uploadStorePhotos({
      storeId: STORE_ID,
      uris: ["file:///tmp/empty.jpg", "file:///tmp/huge.jpg"],
      deps,
    });

    expect(result.uploaded).toEqual([]);
    expect(result.failed).toEqual([
      "file:///tmp/empty.jpg",
      "file:///tmp/huge.jpg",
    ]);
    expect(recorded.tickets).toEqual([]);
  });

  it("does not register a photo whose bytes never reached the bucket", async () => {
    const { deps, recorded } = createDeps(
      {
        "file:///tmp/one.jpg": { bytes: bytes(10), contentType: "image/jpeg" },
      },
      { uploadBytes: async () => false },
    );

    const result = await uploadStorePhotos({
      storeId: STORE_ID,
      uris: ["file:///tmp/one.jpg"],
      deps,
    });

    expect(result).toEqual({ uploaded: [], failed: ["file:///tmp/one.jpg"] });
    expect(recorded.tickets).toHaveLength(1);
    expect(recorded.registered).toEqual([]);
  });

  it("reports a photo the backend refused to register as failed", async () => {
    const { deps } = createDeps(
      {
        "file:///tmp/one.jpg": { bytes: bytes(10), contentType: "image/jpeg" },
      },
      { registerPhoto: async () => false },
    );

    expect(
      await uploadStorePhotos({
        storeId: STORE_ID,
        uris: ["file:///tmp/one.jpg"],
        deps,
      }),
    ).toEqual({ uploaded: [], failed: ["file:///tmp/one.jpg"] });
  });

  it("keeps going after one photo fails so a bad slot cannot block the rest", async () => {
    const { deps } = createDeps(
      {
        "file:///tmp/one.jpg": { bytes: bytes(10), contentType: "image/jpeg" },
        "file:///tmp/two.png": { bytes: bytes(20), contentType: "image/png" },
        "file:///tmp/three.webp": {
          bytes: bytes(30),
          contentType: "image/webp",
        },
      },
      {
        requestUploadTicket: async (storeId, request) =>
          request.contentLength === 20
            ? null
            : {
                objectKey: `stores/${storeId}/${request.contentLength}.jpg`,
                uploadUrl: "https://garage.test/upload",
                contentType: request.contentType,
                contentLength: request.contentLength,
                expiresInSeconds: 900,
              },
      },
    );

    expect(
      await uploadStorePhotos({
        storeId: STORE_ID,
        uris: [
          "file:///tmp/one.jpg",
          "file:///tmp/two.png",
          "file:///tmp/three.webp",
        ],
        deps,
      }),
    ).toEqual({
      uploaded: ["file:///tmp/one.jpg", "file:///tmp/three.webp"],
      failed: ["file:///tmp/two.png"],
    });
  });

  it("treats a thrown dependency as a failed photo, not a crash", async () => {
    const { deps } = createDeps(
      {
        "file:///tmp/one.jpg": { bytes: bytes(10), contentType: "image/jpeg" },
      },
      {
        uploadBytes: async () => {
          throw new Error("network down");
        },
      },
    );

    expect(
      await uploadStorePhotos({
        storeId: STORE_ID,
        uris: ["file:///tmp/one.jpg"],
        deps,
      }),
    ).toEqual({ uploaded: [], failed: ["file:///tmp/one.jpg"] });
  });
});
