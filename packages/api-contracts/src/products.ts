export type StorePaymentMethod = "efectivo" | "pichincha";
export type StoreBankAccountType = "ahorro" | "corriente";

export type Store = {
  id: string;
  ownerProfileId: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  paymentMethod: StorePaymentMethod | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankAccountType: StoreBankAccountType | null;
  active: boolean;
  createdAt: string | null;
};

export type StoreRequest = {
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  paymentMethod?: StorePaymentMethod | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountType?: StoreBankAccountType | null;
};

export type Product = {
  id: string;
  storeId: string | null;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  active: boolean;
  createdAt: string | null;
};

export type ProductRequest = {
  storeId?: string | null;
  name: string;
  description?: string | null;
  price: number;
  stock?: number;
  active?: boolean;
};
