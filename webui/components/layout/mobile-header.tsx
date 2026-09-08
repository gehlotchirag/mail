"use client";

import { Menu, ArrowLeft, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/ui-store";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { AccountSwitcher } from "./account-switcher";
import { useConfig } from "@/hooks/use-config";
import { useThemeStore } from "@/stores/theme-store";

interface MobileHeaderProps {
  title?: string;
  showBack?: boolean;
  onBack?: () => void;
  onCompose?: () => void;
  onSearch?: () => void;
  className?: string;
}

export function MobileHeader({
  showBack = false,
  onBack,
  onSearch,
  className,
}: MobileHeaderProps) {
  const t = useTranslations('sidebar');
  const { toggleSidebar, goBack, sidebarOpen } = useUIStore();
  const { appLogoLightUrl, appLogoDarkUrl, appName } = useConfig();
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const logoUrl = resolvedTheme === 'dark' ? (appLogoDarkUrl || appLogoLightUrl) : (appLogoLightUrl || appLogoDarkUrl);

  const handleLeftAction = () => {
    if (showBack && onBack) {
      onBack();
    } else if (showBack) {
      goBack();
    } else {
      toggleSidebar();
    }
  };

  return (
    <header
      className={cn(
        "flex items-center justify-between px-2 h-14 border-b border-border bg-background shrink-0",
        "lg:hidden",
        className
      )}
    >
      {/* Left: menu/back + logo + app name */}
      <div className="flex items-center gap-1 min-w-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleLeftAction}
          className={cn(
            "h-10 w-10 flex-shrink-0",
            !showBack && sidebarOpen && "bg-accent"
          )}
          aria-label={showBack ? "Go back" : "Toggle menu"}
          aria-expanded={!showBack ? sidebarOpen : undefined}
        >
          {showBack ? (
            <ArrowLeft className="h-5 w-5" />
          ) : sidebarOpen ? (
            <X className="h-5 w-5" />
          ) : (
            <Menu className="h-5 w-5" />
          )}
        </Button>

        {logoUrl && (
          <img src={logoUrl} alt="" className="w-6 h-6 object-contain flex-shrink-0" />
        )}
        <span className="font-semibold text-base text-foreground truncate ml-1">
          {appName || "Mail"}
        </span>
      </div>

      {/* Right: search + avatar */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {onSearch && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onSearch}
            className="h-10 w-10"
            aria-label={t('mobile.search')}
          >
            <Search className="h-5 w-5" />
          </Button>
        )}
        <AccountSwitcher variant="rail" popoverDirection="down" />
      </div>
    </header>
  );
}

/**
 * Viewer header for mobile - shows when viewing an email
 */
interface MobileViewerHeaderProps {
  subject?: string;
  onBack: () => void;
  onDelete?: () => void;
  onArchive?: () => void;
  className?: string;
}

export function MobileViewerHeader({
  subject,
  onBack,
  onDelete: _onDelete,
  onArchive: _onArchive,
  className,
}: MobileViewerHeaderProps) {
  const t = useTranslations('sidebar');

  return (
    <header
      className={cn(
        "flex items-center justify-between px-2 h-14 border-b border-border bg-background shrink-0",
        "lg:hidden", // Only visible on mobile/tablet
        className
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={onBack}
        className="h-11 w-11"
        aria-label={t('mobile.go_back')}
      >
        <ArrowLeft className="h-5 w-5" />
      </Button>

      <h1 className="flex-1 font-medium text-sm truncate px-2 text-center">
        {subject || "(No Subject)"}
      </h1>

      <div className="flex items-center">
        {/* Placeholder for additional actions - kept minimal */}
        <div className="w-10" />
      </div>
    </header>
  );
}
