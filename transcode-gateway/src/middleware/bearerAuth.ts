export function extractBearer(authorization: string | undefined): string | null {
  if (!authorization) return null;
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  return token.length > 0 ? token : null;
}
