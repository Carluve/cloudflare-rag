/* eslint-disable @typescript-eslint/no-explicit-any */
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { getDocumentProxy, extractText } from "unpdf";
import mammoth from "mammoth";
import { drizzle, DrizzleD1Database } from "drizzle-orm/d1";
import { documentChunks, documents } from "../../schema";
import { ulid } from "ulidx";
import { DrizzleError } from "drizzle-orm";
import { exampleFiles } from "../../app/lib/exampleFiles";

async function uploadToR2(file: File, r2Bucket: R2Bucket, sessionId: string): Promise<string> {
  const r2Key = `${sessionId}/${Date.now()}-${file.name}`;
  await r2Bucket.put(r2Key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });
  return r2Key;
}

async function extractTextFromPDF(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const result = await extractText(pdf, { mergePages: true });
  return Array.isArray(result.text) ? result.text.join(" ") : result.text;
}

async function extractTextFromDocx(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}

async function extractTextFromTxt(file: File): Promise<string> {
  return await file.text();
}

function getFileType(file: File): "pdf" | "docx" | "txt" | "unknown" {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx") || name.endsWith(".doc")) return "docx";
  if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".csv")) return "txt";
  if (file.type === "application/pdf") return "pdf";
  if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (file.type === "application/msword") return "docx";
  if (file.type.startsWith("text/")) return "txt";
  return "unknown";
}

async function extractTextFromFile(file: File): Promise<string> {
  const type = getFileType(file);
  switch (type) {
    case "pdf": return extractTextFromPDF(file);
    case "docx": return extractTextFromDocx(file);
    case "txt": return extractTextFromTxt(file);
    default: throw new Error(`Unsupported file type: ${file.name}. Supported: PDF, DOCX, DOC, TXT`);
  }
}

/**
 * Wrap a promise with a timeout. Rejects if ms elapsed.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

async function extractImagesFromPDF(file: File): Promise<string[]> {
  const imageUrls: string[] = [];

  try {
    const buffer = await file.arrayBuffer();
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const maxPages = Math.min(pdf.numPages, 20); // cap pages to scan

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      try {
        const page = await withTimeout(pdf.getPage(pageNum), 5000);
        const ops = await withTimeout(page.getOperatorList(), 5000);

        for (let i = 0; i < ops.fnArray.length; i++) {
          if (ops.fnArray[i] === 85) {
            const imageName = ops.argsArray[i][0];
            try {
              const img = await withTimeout(page.objs.get(imageName), 3000);
              if (img && img.data && img.width && img.height) {
                const dataUrl = createImageDataURL(img.data, img.width, img.height);
                if (dataUrl) {
                  imageUrls.push(dataUrl);
                }
              }
            } catch {
              // timeout or extraction error — skip this image
            }
          }
        }
      } catch {
        // timeout or page error — skip this page
      }
    }
  } catch (e) {
    console.log("Image extraction failed, continuing:", e);
  }

  return imageUrls;
}

function createImageDataURL(data: Uint8ClampedArray, width: number, height: number): string | null {
  try {
    if (!data || !width || !height || width > 4096 || height > 4096) return null;

    const pixelCount = width * height;
    if (data.length < pixelCount * 3) return null;

    const headerSize = 54;
    const rowSize = Math.ceil((width * 3) / 4) * 4;
    const pixelDataSize = rowSize * height;
    const fileSize = headerSize + pixelDataSize;

    const bmp = new Uint8Array(fileSize);
    const view = new DataView(bmp.buffer);

    bmp[0] = 0x42; bmp[1] = 0x4d;
    view.setUint32(2, fileSize, true);
    view.setUint32(10, headerSize, true);
    view.setUint32(14, 40, true);
    view.setInt32(18, width, true);
    view.setInt32(22, -height, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, 24, true);
    view.setUint32(34, pixelDataSize, true);

    let offset = headerSize;
    const channels = data.length / pixelCount >= 4 ? 4 : 3;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = (y * width + x) * channels;
        bmp[offset++] = data[srcIdx + 2] || 0;
        bmp[offset++] = data[srcIdx + 1] || 0;
        bmp[offset++] = data[srcIdx] || 0;
      }
      const padding = rowSize - width * 3;
      for (let p = 0; p < padding; p++) {
        bmp[offset++] = 0;
      }
    }

    let binary = "";
    for (let i = 0; i < bmp.length; i++) {
      binary += String.fromCharCode(bmp[i]);
    }
    return `data:image/bmp;base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

async function insertDocument(
  db: any,
  file: File,
  textContent: string,
  sessionId: string,
  r2Url: string
) {
  const row = {
    id: ulid(),
    name: file.name,
    size: file.size,
    textContent,
    sessionId,
    r2Url,
  };
  return db.insert(documents).values(row).returning({ insertedId: documents.id });
}

/**
 * Process chunks SEQUENTIALLY in batches to avoid overwhelming
 * Workers AI, D1, and Vectorize concurrent limits.
 */
async function insertVectors(
  db: DrizzleD1Database<any>,
  VECTORIZE_INDEX: VectorizeIndex,
  AI: any,
  chunks: string[],
  sessionId: string,
  documentId: string,
  sendEvent: (message: any) => Promise<void>
) {
  const batchSize = 10;
  const totalBatches = Math.ceil(chunks.length / batchSize);

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const start = batchIdx * batchSize;
    const chunkBatch = chunks.slice(start, start + batchSize);

    // 1. Generate embeddings
    const embeddingResult = await AI.run("@cf/baai/bge-large-en-v1.5", {
      text: chunkBatch,
    });
    const embeddingBatch: number[][] = embeddingResult.data;

    // 2. Insert chunks into D1
    const chunkInsertResults = await db
      .insert(documentChunks)
      .values(
        chunkBatch.map((chunk) => ({
          id: ulid(),
          text: chunk,
          sessionId,
          documentId,
        }))
      )
      .returning({ insertedChunkId: documentChunks.id });

    const chunkIds = chunkInsertResults.map((r) => r.insertedChunkId);

    // 3. Insert vectors into Vectorize
    await VECTORIZE_INDEX.insert(
      embeddingBatch.map((embedding, index) => ({
        id: chunkIds[index],
        values: embedding,
        namespace: "default",
        metadata: {
          sessionId,
          documentId,
          chunkId: chunkIds[index],
          text: chunkBatch[index],
        },
      }))
    );

    // 4. Report progress
    const pct = Math.round(((batchIdx + 1) / totalBatches) * 100);
    await sendEvent({
      step: "embedding",
      message: `Embedding batch ${batchIdx + 1}/${totalBatches} (${pct}%)`,
      progress: pct,
    });
  }
}

export async function handleUpload(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const ipAddress = request.headers.get("cf-connecting-ip") || "";

  const sendEvent = async (payload: any) => {
    try {
      await writer.write(
        new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`)
      );
    } catch {
      // Writer already closed, ignore
    }
  };

  // Rate limiting
  const rateLimit = await env.rate_limiter.get(ipAddress);
  if (rateLimit) {
    const lastRequestTime = parseInt(rateLimit);
    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime - lastRequestTime < 3) {
      return new Response(
        `Too many requests (${currentTime - lastRequestTime}s since last)`,
        { status: 429 }
      );
    }
  }
  await env.rate_limiter.put(ipAddress, Math.floor(Date.now() / 1000).toString(), {
    expirationTtl: 60,
  });

  ctx.waitUntil(
    (async () => {
      try {
        const formData = await request.formData();
        const file = formData.get("pdf") as File;
        const sessionId = formData.get("sessionId") as string;

        if (exampleFiles.some((ex) => ex.sessionId === sessionId)) {
          await sendEvent({
            error: "Cannot upload to example session. Reload and try again.",
          });
          await writer.close();
          return;
        }

        const db = drizzle(env.DB);

        if (!file || typeof file !== "object" || !("arrayBuffer" in file)) {
          await sendEvent({ error: "Please upload a file (PDF, DOCX, DOC, or TXT)." });
          await writer.close();
          return;
        }

        if (getFileType(file) === "unknown") {
          await sendEvent({ error: `Unsupported file: ${file.name}. Use PDF, DOCX, DOC, or TXT.` });
          await writer.close();
          return;
        }

        // --- Step 1: Upload & extract text ---
        await sendEvent({ step: "upload", message: "Uploading file..." });

        const fileType = getFileType(file);

        const [r2Url, textContent] = await Promise.all([
          uploadToR2(file, env.R2_BUCKET, sessionId),
          extractTextFromFile(file),
        ]);

        await sendEvent({ step: "extract_text", message: `Text extracted from ${fileType.toUpperCase()}` });

        // --- Step 2: Extract images (PDFs only) ---
        let images: string[] = [];
        if (fileType === "pdf") {
          await sendEvent({ step: "extract_images", message: "Looking for images..." });
          try {
            images = await extractImagesFromPDF(file);
            if (images.length > 0) {
              await sendEvent({ step: "extract_images", message: `Found ${images.length} images`, images });
            } else {
              await sendEvent({ step: "extract_images", message: "No images found" });
            }
          } catch (e) {
            console.log("Image extraction failed:", e);
            await sendEvent({ step: "extract_images", message: "Skipped" });
          }
        } else {
          await sendEvent({ step: "extract_images", message: "N/A (not a PDF)" });
        }

        // --- Step 3: Insert document & split ---
        const insertResult = await insertDocument(db, file, textContent, sessionId, r2Url);

        const splitter = new RecursiveCharacterTextSplitter({
          chunkSize: 500,
          chunkOverlap: 100,
        });
        const chunks = await splitter.splitText(textContent);

        await sendEvent({
          step: "chunking",
          message: `Split into ${chunks.length} chunks`,
          totalChunks: chunks.length,
        });

        // --- Step 4: Embed & index (sequential batches) ---
        await insertVectors(
          db,
          env.VECTORIZE_INDEX,
          env.AI,
          chunks,
          sessionId,
          insertResult[0].insertedId,
          sendEvent
        );

        // --- Step 5: Done ---
        await sendEvent({
          step: "done",
          message: "Processing complete",
          documentId: insertResult[0].insertedId,
          name: file.name,
          type: file.type,
          size: file.size,
          r2Url,
          totalChunks: chunks.length,
          totalImages: images.length,
        });

        await writer.close();
      } catch (error) {
        if (error instanceof DrizzleError) {
          console.error("Drizzle error:", error.cause);
        }
        console.error("Error processing upload:", (error as Error).stack);
        await sendEvent({
          error: `Upload failed: ${(error as Error).message}`,
        });
        try {
          await writer.close();
        } catch {
          /* already closed */
        }
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
