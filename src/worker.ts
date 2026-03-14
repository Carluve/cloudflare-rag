import { createRequestHandler } from "@remix-run/cloudflare";
import { handleUpload } from "./api/upload";
import { handleStream } from "./api/stream";
import { handleListDocuments } from "./api/documents";

// @ts-ignore - server build is generated at build time
import * as build from "../build/server";

const requestHandler = createRequestHandler(build, "production");

export interface WorkerEnv extends Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // API routes
    if (url.pathname === "/api/upload" && request.method === "POST") {
      return handleUpload(request, env, ctx);
    }
    if (url.pathname === "/api/stream" && request.method === "POST") {
      return handleStream(request, env, ctx);
    }
    if (url.pathname === "/api/documents" && request.method === "GET") {
      return handleListDocuments(request, env);
    }

    // Static assets
    const hasExtension = url.pathname.match(/\.\w+$/);
    if (hasExtension) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        return assetResponse;
      }
    }

    // Remix SSR
    try {
      return await requestHandler(request, {
        cloudflare: { env, ctx },
      });
    } catch (error) {
      console.error("Remix handler error:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
} satisfies ExportedHandler<WorkerEnv>;
