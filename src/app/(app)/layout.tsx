import { requireUser } from "@/server/guards";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppBackdrop } from "@/components/layout/app-backdrop";
import { Topbar } from "@/components/layout/topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { CommandCenter } from "@/components/shared/command-center";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <>
      {/* Decorative floating-market layer behind the whole app (see AppBackdrop). */}
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
      </SidebarProvider>
    </>
  );
}
