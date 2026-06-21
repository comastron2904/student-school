export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Workspace from "./Workspace";

export default async function AppPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS가 owner 기준으로 자동 필터링
  const { data: students } = await supabase
    .from("students").select("*").order("created_at", { ascending: true });
  const { data: entries } = await supabase
    .from("entries").select("*").order("updated_at", { ascending: false });

  return <Workspace initialStudents={students || []} initialEntries={entries || []} userEmail={user.email} />;
}
