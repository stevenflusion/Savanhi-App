import type { StoredAuthSession } from "../../domain/auth.types";

export type AuthSessionRepository = {
  load: () => Promise<StoredAuthSession | null>;
  save: (value: StoredAuthSession | null) => Promise<void>;
  saveIfCurrent: (
    expected: StoredAuthSession,
    value: StoredAuthSession | null,
  ) => Promise<boolean>;
};
