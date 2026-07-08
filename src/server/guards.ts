import { redirect } from "next/navigation";

import { auth } from "@/server/auth";

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return session.user;
}
