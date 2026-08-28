/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Внешних CDN нет намеренно: данные о позициях клиентов не должны утекать наружу.
  poweredByHeader: false,
};

export default nextConfig;
