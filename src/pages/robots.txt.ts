import type { APIRoute } from 'astro';

const body = `User-agent: *
Allow: /

Sitemap: https://wizytowka.link/llms.txt
`;

export const GET: APIRoute = async () => {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800',
    },
  });
};
