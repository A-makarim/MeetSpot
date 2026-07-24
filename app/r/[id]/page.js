import { redirect } from "next/navigation";

export default async function GroupRoomPage({ params }) {
  const { id } = await params;
  redirect(`/?room=${encodeURIComponent(id)}`);
}
