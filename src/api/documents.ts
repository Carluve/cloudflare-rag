import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { documents } from "../../schema";

export async function handleListDocuments(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }

  const db = drizzle(env.DB);
  const docs = await db
    .select({
      id: documents.id,
      name: documents.name,
      size: documents.size,
      sessionId: documents.sessionId,
    })
    .from(documents)
    .where(eq(documents.sessionId, sessionId));

  return Response.json({ documents: docs });
}
