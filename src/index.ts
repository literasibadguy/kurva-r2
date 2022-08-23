/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npx wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npx wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

// These initial Types are based on bindings that don't exist in the project yet,
// you can follow the links to learn how to implement them.

export interface Env {
	// Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
	// MY_KV_NAMESPACE: KVNamespace
	//
	// Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
	// MY_DURABLE_OBJECT: DurableObjectNamespace
	//
	// Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
	TESTING_R2_KURVA: R2Bucket;
}

function parseRange(
	encoded: string | null
): undefined | { offset: number; length: number } {
	if (encoded === null) {
		return;
	}

	const parts = encoded.split("bytes=")[1]?.split("-") ?? [];
	if (parts.length !== 2) {
		throw new Error(
			"Not supported to skip specifying the beginning/ending byte at this time"
		);
	}

	return {
		offset: Number(parts[0]),
		end: Number(parts[1]),
		length: Number(parts[1]) + 1 - Number(parts[0]),
	};
}

function objectNotFound(objectName: string): Response {
	return new Response(
		`<html><body>R2 object "<b>${objectName}</b>" not found</body></html>`,
		{
			status: 404,
			headers: {
				"content-type": "text/html; charset=UTF-8",
			},
		}
	);
}

const worker = {
	async fetch(
		request: Request,
		env: Env
	): Promise<Response> {
		const url = new URL(request.url);
		const objectName = url.pathname.slice(1);

		console.log(`${request.method} object ${objectName}: ${request.url}`);

		if (request.method === "GET" || request.method === "HEAD") {
			if (objectName === "") {
				if (request.method == "HEAD") {
					return new Response(undefined, { status: 400 });
				}

				const options: R2ListOptions = {
					prefix: url.searchParams.get("prefix") ?? undefined,
					delimiter: url.searchParams.get("delimiter") ?? undefined,
					cursor: url.searchParams.get("cursor") ?? undefined,
					include: ["customMetadata", "httpMetadata"],
				};
				console.log(JSON.stringify(options));

				const listing = await env.TESTING_R2_KURVA.list(options);
				return new Response(JSON.stringify(listing), {
					headers: {
						"content-type": "application/json; charset=UTF-8",
					},
				});
			}

			if (request.method === "GET") {
				const range = parseRange(request.headers.get("range"));
				const object = await env.TESTING_R2_KURVA.get(objectName, {
					range,
					onlyIf: request.headers,
				});

				if (object === null) {
					return objectNotFound(objectName);
				}

				const headers = new Headers();
				object.writeHttpMetadata(headers);
				headers.set("etag", object.httpEtag);
				if (range) {
					headers.set(
						"content-range",
						`bytes ${range.offset}-${range.offset}/${object.size}`
					);
				}
				const status = object.body ? (range ? 206 : 200) : 304;
				return new Response(object.body, {
					headers,
					status,
				});
			}

			const object = await env.TESTING_R2_KURVA.head(objectName);

			if (object === null) {
				return objectNotFound(objectName);
			}

			const headers = new Headers();
			object.writeHttpMetadata(headers);
			headers.set("etag", object.httpEtag);
			return new Response(null, {
				headers,
			});
		}

		return new Response(`Unsupported method`, {
			status: 400,
		});
	},
};

export default worker;
