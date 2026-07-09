// 410 Gone response for locality/business URLs that are genuinely dead — i.e.
// no current locality can be recovered from the path. The decision of *which*
// stale URLs are dead (410) versus moved (301) now lives in slug-redirect.ts
// (`resolveStaleLocalityUrl`); this module only owns the terminal 410 body.

export function goneResponse(): Response {
	const body = `<!DOCTYPE html>
<html lang="pl"><head><meta charset="utf-8"><title>Strona usunięta — wizytowka.link</title><meta name="robots" content="noindex"></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 16px;text-align:center;color:#374151"><h1 style="font-size:22px">Strona usunięta</h1><p>Ten adres nie jest już używany. <a href="/" style="color:#2563eb">Wróć na stronę główną</a>.</p></body></html>`;
	return new Response(body, {
		status: 410,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "public, max-age=86400",
		},
	});
}
