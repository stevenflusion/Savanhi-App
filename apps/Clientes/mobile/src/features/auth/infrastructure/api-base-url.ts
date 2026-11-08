type ApiBaseUrlOptions = {
  override?: string;
  expoHostUri?: string | null;
  isDevelopment: boolean;
};

const ENV_NAME = "EXPO_PUBLIC_CLIENTES_API_URL";
const LOCALHOST_API_BASE_URL = "http://localhost:4300";
const RELEASE_API_URL_ERROR = `${ENV_NAME} is required in release builds and must use HTTPS.`;

function normalizeHttpBaseUrl(value: string, source: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${source} must not be empty.`);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${source} must be a valid absolute URL.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${source} must use http or https.`);
  }
  if (!url.hostname || url.username || url.password) {
    throw new Error(`${source} must contain a valid host without credentials.`);
  }
  if (url.search || url.hash) {
    throw new Error(`${source} must not contain a query or fragment.`);
  }

  const normalizedPath = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${normalizedPath}`;
}

function hostnameFromExpoHostUri(hostUri: string): string {
  const trimmed = hostUri.trim();
  if (!trimmed) {
    throw new Error("Expo host URI must not be empty.");
  }

  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
  } catch {
    throw new Error("Expo host URI must contain a valid host.");
  }

  if (!url.hostname || url.username || url.password) {
    throw new Error(
      "Expo host URI must contain a valid host without credentials.",
    );
  }

  return url.hostname;
}

/**
 * Development derives the backend host from the Expo dev server, so a phone on
 * the LAN reaches the PC. `localhost` is only the last resort (an emulator or
 * a web preview). Release builds require an explicit HTTPS address.
 */
export function resolveClientesApiBaseUrl({
  override,
  expoHostUri,
  isDevelopment,
}: ApiBaseUrlOptions): string {
  const explicitOverride = override?.trim();

  if (!isDevelopment) {
    if (!explicitOverride) {
      throw new Error(RELEASE_API_URL_ERROR);
    }

    const releaseUrl = normalizeHttpBaseUrl(explicitOverride, ENV_NAME);
    if (!releaseUrl.startsWith("https://")) {
      throw new Error(RELEASE_API_URL_ERROR);
    }

    return releaseUrl;
  }

  if (explicitOverride) {
    return normalizeHttpBaseUrl(explicitOverride, ENV_NAME);
  }

  if (expoHostUri !== undefined && expoHostUri !== null) {
    const hostname = hostnameFromExpoHostUri(expoHostUri);
    const formattedHostname =
      hostname.includes(":") && !hostname.startsWith("[")
        ? `[${hostname}]`
        : hostname;

    return normalizeHttpBaseUrl(
      `http://${formattedHostname}:4300`,
      "Expo-derived API URL",
    );
  }

  return LOCALHOST_API_BASE_URL;
}
