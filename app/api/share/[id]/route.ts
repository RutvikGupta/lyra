import { isValidShareId } from "@/lib/share-id";
import { readShare } from "@/lib/share-store";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!isValidShareId(id)) {
    return Response.json({ error: "invalid_id" }, { status: 400 });
  }
  try {
    const snap = await readShare(id);
    if (!snap) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    return Response.json(snap, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch {
    return Response.json({ error: "read_failed" }, { status: 500 });
  }
}
