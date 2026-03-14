import { eq, inArray, sql } from "drizzle-orm";
import { drizzle, DrizzleD1Database } from "drizzle-orm/d1";
import { documentChunks } from "../../schema";
import { llmResponse, streamLLMResponse } from "../../app/lib/aiGateway";

interface EmbeddingResponse {
  shape: number[];
  data: number[][];
}

interface RoleScopedChatInput {
  role: string;
  content: string;
}

async function rewriteToQueries(content: string, env: Env): Promise<string[]> {
  const prompt = `Given the following user message, rewrite it into 5 distinct search queries to find relevant information in documents. Each query should cover different aspects. Output only the queries, one per line, no numbering.

User message: "${content}"`;

  const response = await llmResponse({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    messages: [{ role: "user", content: prompt }],
    apiKeys: {
      openai: env.OPENAI_API_KEY,
      groq: env.GROQ_API_KEY,
      anthropic: env.ANTHROPIC_API_KEY,
    },
    model: "llama-3.1-8b-instant",
    provider: "groq",
    AI: env.AI,
  });

  return response
    .split("\n")
    .map((q: string) => q.replace(/^\d+[\.\)]\s*/, "").replace(/^["']|["']$/g, "").trim())
    .filter((q: string) => q.length > 3)
    .slice(0, 5);
}

interface DocumentChunk {
  id: string;
  document_id: string;
  text: string;
  session_id: string;
  rank: number;
}

/**
 * Full-text search filtered by sessionId.
 */
async function searchDocumentChunks(
  searchTerms: string[],
  db: DrizzleD1Database<any>,
  sessionId: string
) {
  const allResults: DocumentChunk[] = [];

  for (const term of searchTerms.filter(Boolean)) {
    try {
      const sanitized = term.trim().replace(/[^\w\s]/g, "");
      if (!sanitized) continue;

      const { results } = (await db.run(sql`
        SELECT dc.*, fts.rank
        FROM document_chunks_fts fts
        JOIN document_chunks dc ON fts.id = dc.id
        WHERE fts MATCH ${sanitized}
          AND dc.session_id = ${sessionId}
        ORDER BY fts.rank DESC
        LIMIT 5
      `)) as { results: DocumentChunk[] };

      allResults.push(...results);
    } catch (e) {
      console.log("FTS query error for term:", term, e);
    }
  }

  // Deduplicate by id
  const seen = new Set<string>();
  return allResults
    .filter((r) => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 10);
}

function performReciprocalRankFusion(
  fullTextResults: DocumentChunk[],
  vectorResults: VectorizeMatches[]
): { id: string; score: number }[] {
  const k = 60;
  const scores: Record<string, number> = {};

  fullTextResults.forEach((r, i) => {
    scores[r.id] = (scores[r.id] || 0) + 1 / (k + i);
  });

  vectorResults.forEach((r) => {
    r.matches.forEach((m, i) => {
      scores[m.id] = (scores[m.id] || 0) + 1 / (k + i);
    });
  });

  return Object.entries(scores)
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

async function queryVectorIndex(queries: string[], env: Env, sessionId: string) {
  const queryVectors: EmbeddingResponse[] = await Promise.all(
    queries.map((q) => env.AI.run("@cf/baai/bge-large-en-v1.5", { text: [q] }))
  );

  const allResults = await Promise.all(
    queryVectors.map((qv) =>
      env.VECTORIZE_INDEX.query(qv.data[0], {
        topK: 5,
        returnValues: false,
        returnMetadata: "all",
        namespace: "default",
        filter: { sessionId },
      })
    )
  );

  return allResults;
}

async function getRelevantDocuments(ids: string[], db: DrizzleD1Database<any>) {
  if (ids.length === 0) return [];
  return db
    .select({ text: documentChunks.text })
    .from(documentChunks)
    .where(inArray(documentChunks.id, ids));
}

const NO_CONTEXT_SYSTEM = `You are a helpful assistant. The user has uploaded documents and is asking questions about them. However, no relevant context was found for this query. Tell the user clearly that you could not find relevant information in the uploaded documents for their question, and suggest they try rephrasing or uploading additional documents. Do NOT make up information.`;

async function processUserQuery(json: any, env: Env, writer: WritableStreamDefaultWriter) {
  const { provider, model, sessionId, systemPrompt } = json;
  const messages: RoleScopedChatInput[] = json.messages as RoleScopedChatInput[];
  const lastMessage = messages[messages.length - 1];
  const query = lastMessage.content;

  const db = drizzle(env.DB);
  const enc = new TextEncoder();
  const send = (data: any) => writer.write(enc.encode(`data: ${JSON.stringify(data)}\n\n`));

  await send({ message: "Rewriting message to queries..." });

  const queries = await rewriteToQueries(query, env);
  await send({ message: "Querying vector index and full text search...", queries });

  console.log("Searching with sessionId:", sessionId, "queries:", queries);

  const [ftsResults, vectorResults] = await Promise.all([
    searchDocumentChunks(queries, db, sessionId),
    queryVectorIndex(queries, env, sessionId),
  ]);

  console.log("FTS results:", ftsResults.length, "Vector results:", vectorResults.map(v => v.matches.length));

  const merged = performReciprocalRankFusion(ftsResults, vectorResults);
  const topIds = merged.map((r) => r.id).slice(0, 10);
  const relevantDocs = await getRelevantDocuments(topIds, db);

  console.log("Relevant docs found:", relevantDocs.length);

  if (relevantDocs.length === 0) {
    // No context found - use a strict system prompt
    await send({ message: "No relevant documents found for this query.", relevantContext: [], queries });
    messages.unshift({ role: "system", content: NO_CONTEXT_SYSTEM });
    return { messages, provider, model };
  }

  const relevantTexts = relevantDocs
    .map((doc, i) => `[${i + 1}]: ${doc.text}`)
    .join("\n\n");

  await send({
    message: "Found relevant documents, generating response...",
    relevantContext: relevantDocs,
    queries,
  });

  const sysMessage = systemPrompt || "You are a helpful assistant that answers questions based on the provided context. Always cite sources using [1], [2], etc. If the context does not contain enough information, say so clearly.";
  messages.unshift({ role: "system", content: sysMessage });

  messages.push({
    role: "assistant",
    content: `Here is the relevant context from the uploaded documents:\n${relevantTexts}\n\nI will now answer based on this context.`,
  });

  return { messages, provider, model };
}

async function doStreamResponse(
  params: Awaited<ReturnType<typeof processUserQuery>>,
  env: Env,
  writable: WritableStream
) {
  const IS_DEMO = env.CLOUDFLARE_ACCOUNT_ID === "fa3e82d8258ac121c26085c2a5952780";
  const { messages, provider, model } = params;

  const stream = await streamLLMResponse({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    messages: messages as any,
    apiKeys: {
      anthropic: env.ANTHROPIC_API_KEY,
      openai: env.OPENAI_API_KEY,
      groq: env.GROQ_API_KEY,
    },
    model,
    provider,
    AI: env.AI,
    isDemo: IS_DEMO,
  });

  (stream as Response).body
    ? await (stream as Response).body?.pipeTo(writable)
    : await (stream as ReadableStream).pipeTo(writable);
}

export async function handleStream(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const ip = request.headers.get("cf-connecting-ip") || "";

  const rateLimit = await env.rate_limiter.get(ip);
  if (rateLimit) {
    const last = parseInt(rateLimit);
    const now = Math.floor(Date.now() / 1000);
    if (now - last < 3) {
      return new Response("Too many requests", { status: 429 });
    }
  }
  await env.rate_limiter.put(ip, Math.floor(Date.now() / 1000).toString(), { expirationTtl: 60 });

  ctx.waitUntil(
    (async () => {
      try {
        const json = await request.json();
        const params = await processUserQuery(json, env, writer);
        writer.releaseLock();
        await doStreamResponse(params, env, writable);
      } catch (error) {
        console.error("Stream error:", error);
        await writer.write(
          new TextEncoder().encode(`data: ${JSON.stringify({ error: (error as Error).message })}\n\n`)
        );
        await writer.close();
      }
    })()
  );

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Transfer-Encoding": "chunked",
      "content-encoding": "identity",
    },
  });
}
