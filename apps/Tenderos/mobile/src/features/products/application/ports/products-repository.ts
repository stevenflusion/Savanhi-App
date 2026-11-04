import type { StoreWithPhotos } from "@/src/features/auth/infrastructure/store-photos-fetch-repository";

import type { Product } from "../../domain/product";

export type ProductsResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/** The tendero's own store, with the photos T2 attached to `stores/me`. */
export type ProductStore = StoreWithPhotos;

/**
 * The reads every product screen shares (S14).
 *
 * `listStoreProducts` returns the shared catalog assignments and the
 * store-private rows already flattened into ONE list, in the order the
 * workspace has always shown them (shared first). It exists so the workspace,
 * the product detail and the Perfil tab read the SAME two routes through the
 * same mapping instead of three copies that could word a price or a category
 * differently.
 *
 * Writes are NOT here: the workspace owns them and they are unchanged by this
 * unit.
 */
export type ProductsRepository = {
  listOwnStores: () => Promise<ProductsResult<ProductStore[]>>;
  listStoreProducts: (storeId: string) => Promise<ProductsResult<Product[]>>;
};
