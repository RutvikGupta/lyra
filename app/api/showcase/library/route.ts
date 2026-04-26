import { readSnapshot } from "@/lib/showcase-library-store";

export async function GET() {
  try {
    const snap = await readSnapshot();
    if (!snap) {
      return Response.json({ error: "no_snapshot" }, { status: 404 });
    }
    return Response.json(snap, {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  } catch {
    return Response.json({ error: "snapshot_read_failed" }, { status: 500 });
  }
}
