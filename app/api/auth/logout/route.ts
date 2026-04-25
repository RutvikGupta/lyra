import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { REFRESH_COOKIE } from "@/lib/spotify";

export async function POST(req: Request) {
  const store = await cookies();
  store.delete(REFRESH_COOKIE);
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
