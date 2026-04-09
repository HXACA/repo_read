import { redirect } from "next/navigation";

// Old provider settings page — redirect to home.
// Settings are now in the slide-out panel accessible from the header gear icon.
export default function ProvidersPage() {
  redirect("/");
}
