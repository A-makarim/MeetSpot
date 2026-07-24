import { NextResponse } from "next/server";
import { createMeetingToken } from "../../../lib/meeting-token";

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body.organizerName || !body.organizerLocation || !body.query || !body.meetingTime) {
      return NextResponse.json({ error: "Name, location, request, and time are required" }, { status: 400 });
    }
    const meetingTime = new Date(body.meetingTime);
    if (Number.isNaN(meetingTime.valueOf()) || meetingTime < new Date()) {
      return NextResponse.json({ error: "Choose a future meeting time" }, { status: 400 });
    }
    const token = await createMeetingToken({
      organizerName: String(body.organizerName).slice(0, 50),
      organizerLocation: String(body.organizerLocation).slice(0, 200),
      query: String(body.query).slice(0, 200),
      travelMode: String(body.travelMode || "TRANSIT").slice(0, 20),
      maxMinutes: Math.min(Math.max(Number(body.maxMinutes) || 30, 5), 180),
      meetingTime: meetingTime.toISOString(),
      expiresAt: new Date(meetingTime.getTime() + 86400000).toISOString(),
    });
    return NextResponse.json(
      { id: token, url: `${new URL(request.url).origin}/m/${token}` },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json({ error: error.message || "Could not create meeting" }, { status: 400 });
  }
}
