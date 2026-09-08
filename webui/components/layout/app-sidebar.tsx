"use client";

import { useEmailStore } from "@/stores/email-store";
import { useUIStore } from "@/stores/ui-store";
import { useRouter } from "next/navigation";
import { Sidebar } from "./sidebar";
import { DragDropProvider } from "@/contexts/drag-drop-context";

export function AppSidebar({ className }: { className?: string }) {
  const router = useRouter();
  const { mailboxes, quota } = useEmailStore();
  const { sidebarCollapsed, sidebarWidth } = useUIStore();

  return (
    <div
      className="flex-shrink-0 h-full transition-[width] duration-300"
      style={{ width: sidebarCollapsed ? 48 : sidebarWidth }}
    >
      <DragDropProvider>
        <Sidebar
          mailboxes={mailboxes}
          quota={quota ?? null}
          onMailboxSelect={(id) => router.push(`/?mailbox=${id}`)}
          onCompose={() => router.push("/")}
          className={className}
        />
      </DragDropProvider>
    </div>
  );
}
