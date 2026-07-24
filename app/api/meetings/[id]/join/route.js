import { NextResponse } from "next/server";
import { readMeetingToken } from "../../../../../lib/meeting-token";
import { buildRecommendations } from "../../../../../lib/recommend";

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const meeting = await readMeetingToken(id);
    const body = await request.json();
    if (!body.guestName || !body.guestLocation) {
      return NextResponse.json({ error: "Your name and location are required" }, { status: 400 });
    }
    const results = await buildRecommendations({
      personA: meeting.organizerLocation,
      personB: body.guestLocation,
      query: meeting.query,
      travelMode: meeting.travelMode,
      maxMinutes: meeting.maxMinutes,
      meetingTime: meeting.meetingTime,
    });
    delete results.origins;
    return NextResponse.json({ status: "ready", results });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Could not join meeting" }, { status: 400 });
  }
}
