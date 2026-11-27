const DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** `domains === null` means the owner has not set an allowlist. */
export function staffSignInAllowed(email: string, domains: readonly string[] | null): boolean {
  if (domains == null) return true;
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return false;
  return domains.includes(email.slice(at + 1).toLowerCase());
}

/** An empty list clears the allowlist. It does not become a deny-all. */
export function normalizeStaffDomains(input: readonly string[]): string[] | null | "invalid" {
  if (input.length === 0) return null;
  const cleaned: string[] = [];
  for (const raw of input) {
    const domain = raw.trim().toLowerCase().replace(/\.$/, "");
    if (domain.length === 0 || domain.length > 253 || !DOMAIN.test(domain)) return "invalid";
    cleaned.push(domain);
  }
  return [...new Set(cleaned)].sort();
}
