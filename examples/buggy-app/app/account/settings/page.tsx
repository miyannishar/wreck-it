import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { SettingsForm } from "./SettingsForm";

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/account/settings");
  return (
    <div className="card" style={{ maxWidth: 520 }}>
      <h1>Account settings</h1>
      <p className="muted">Signed in as {user.email}</p>
      <SettingsForm initialName={user.displayName} />
    </div>
  );
}
