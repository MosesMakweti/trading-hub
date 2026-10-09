import { requireUser } from "@/server/guards";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppBackdrop } from "@/components/layout/app-backdrop";
import { Topbar } from "@/components/layout/topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { CommandCenter } from "@/components/shared/command-center";
import { PsychologyResetHost } from "@/components/psychology-reset/psychology-reset-host";
import { getPsychologyResetState } from "@/server/services/psychology-reset.service";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Optional Trading Psychology Reset: OFF (the default) → nothing renders.
  // A failure here never takes the app down.
  const psychologyReset = await getPsychologyResetState(user.id).catch((e) => {
    console.error("[psychology-reset] state load failed", e);
    return { enabled: false, session: null };
  });

  return (
    <>
      {/* Decorative studio-spotlight layer behind the whole app (see AppBackdrop). */}
      <AppBackdrop />
      <SidebarProvider>
        <AppSidebar />
        {/* Transparent canvas so the backdrop shows through the workspace; glass
            cards on top soften the candles beneath them. */}
        <SidebarInset className="bg-transparent">
          <Topbar user={{ name: user.name, email: user.email }} />
          <div className="flex-1 p-6">{children}</div>
        </SidebarInset>
        <CommandCenter />
        <PsychologyResetHost initial={psychologyReset} />
      </SidebarProvider>
    </>
  );
}
