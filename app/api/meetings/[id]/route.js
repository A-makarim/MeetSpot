import { NextResponse } from "next/server";
import { readMeetingToken } from "../../../../lib/meeting-token";

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const meeting = await readMeetingToken(id);
    return NextResponse.json({
      id,
      organizerName: meeting.organizerName,
      guestName: null,
      query: meeting.query,
      travelMode: meeting.travelMode,
      maxMinutes: meeting.maxMinutes,
      meetingTime: meeting.meetingTime,
      status: "waiting",
      results: null,
    });
  } catch {
    return NextResponse.json({ error: "Meeting not found or expired" }, { status: 404 });
  }
}
