const CONTROL_OR_BACKSLASH = /[\\\u0000-\u001f\u007f]/;

function isSafeAppPath(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//") || CONTROL_OR_BACKSLASH.test(value)) {
    return false;
  }

  let decoded = value;
  for (let pass = 0; pass < 2; pass += 1) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return false;
    }

    if (
      !decoded.startsWith("/") ||
      decoded.startsWith("//") ||
      CONTROL_OR_BACKSLASH.test(decoded)
    ) {
      return false;
    }
  }

  try {
    const base = new URL("https://app.invalid");
    const resolved = new URL(value, base);
    return resolved.origin === base.origin;
  } catch {
    return false;
  }
}

/**
 * Accept only an application-local path for post-authentication navigation.
 * Query parameters are untrusted even when they arrive through an auth email.
 */
export function safeAppRedirectPath(
  value: string | null | undefined,
  fallback = "/",
): string {
  const safeFallback = isSafeAppPath(fallback) ? fallback : "/";
  return value && isSafeAppPath(value) ? value : safeFallback;
}
