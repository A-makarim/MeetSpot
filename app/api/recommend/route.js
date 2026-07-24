import { NextResponse } from "next/server";
import { buildRecommendations } from "../../../lib/recommend";

export async function POST(request) {
  try {
    return NextResponse.json(await buildRecommendations(await request.json()));
  } catch (error) {
    return NextResponse.json({ error: error.message || "Recommendation failed" }, { status: 400 });
  }
}
