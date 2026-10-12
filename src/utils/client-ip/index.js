// REA-22: the client's IP, for the attempt limits. The BFF sits behind Cloudflare
// Tunnel and nginx, so the socket address is the proxy's: Cloudflare's header
// first, then the proxy ones. Only used to count attempts, never to authorize.
const first = (value) => String(value || '').split(',')[0].trim();

export const clientIpOf = (req) => {
  const headers = req?.headers || {};
  return (
    first(headers['cf-connecting-ip'])
    || first(headers['x-real-ip'])
    || first(headers['x-forwarded-for'])
    || req?.socket?.remoteAddress
    || req?.ip
    || 'unknown'
  );
};

export default clientIpOf;
