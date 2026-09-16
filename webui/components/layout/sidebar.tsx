"use client";

import { useState, useEffect, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { PluginSlot } from "@/components/plugins/plugin-slot";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Inbox,
  Send,
  File,
  Star,
  Trash2,
  Archive,
  Ban,
  ChevronsLeft,
  ChevronsRight,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  User,
  Palmtree,
  Settings,
  X,
  RotateCcw,
  Tag,
  FlaskConical,
  PlayCircle,
  Loader2,
  Calendar,
  BookUser,
  Pencil,
} from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { useCalendarStore } from "@/stores/calendar-store";
import { useConfig } from "@/hooks/use-config";
import { useThemeStore } from "@/stores/theme-store";
import { cn, buildMailboxTree, MailboxNode } from "@/lib/utils";
import { Mailbox } from "@/lib/jmap/types";
import { useContextMenu } from "@/hooks/use-context-menu";
import { MailboxContextMenu, type MailboxContextTarget } from "./mailbox-context-menu";
import { useAccountStore } from '@/stores/account-store';
import { UNIFIED_MAILBOX_IDS } from '@/lib/jmap/types';
import type { UnifiedMailboxRole } from '@/lib/jmap/types';
import { useDragDropContext } from "@/contexts/drag-drop-context";
import { useMailboxDrop } from "@/hooks/use-mailbox-drop";
import { useTagDrop } from "@/hooks/use-tag-drop";
import { useUIStore } from "@/stores/ui-store";
import { useAuthStore } from "@/stores/auth-store";
import { useVacationStore } from "@/stores/vacation-store";
import { useSettingsStore, KEYWORD_PALETTE, KeywordDefinition } from "@/stores/settings-store";
import { useEmailStore } from "@/stores/email-store";
import { toast } from "@/stores/toast-store";
import { debug } from "@/lib/debug";
import { AccountSwitcher } from "./account-switcher";
import { useTour } from "@/components/tour/tour-provider";

interface SidebarProps {
  mailboxes: Mailbox[];
  selectedMailbox?: string;
  selectedKeyword?: string | null;
  onMailboxSelect?: (mailboxId: string) => void;
  onTagSelect?: (keywordId: string | null) => void;
  onCompose?: () => void;
  onSidebarClose?: () => void;
  onUnreadFilterClick?: (mailboxId: string) => void;
  onMarkFolderRead?: (mailboxId: string) => void;
  onMarkFolderTreeRead?: (mailboxId: string) => void;
  onMarkAllFoldersRead?: () => void;
  onEmptyFolder?: (mailboxId: string) => void;
  onCreateSubfolder?: (parentId: string) => void;
  onCreateFolder?: () => void;
  onRenameFolder?: (mailboxId: string) => void;
  onDeleteFolder?: (mailboxId: string) => void;
  onImportEmail?: (mailboxId: string) => void;
  onRefreshMailboxes?: () => void;
  className?: string;
  quota?: { used: number; total: number } | null;
}

const ROW_PX_BASE = 4;
const CHEVRON_SLOT = 16;
const INDENT_STEP = 12;

const getIconForMailbox = (role?: string, name?: string, hasChildren?: boolean, isExpanded?: boolean, _isShared?: boolean, id?: string) => {
  const lowerName = name?.toLowerCase() || "";

  if (id?.startsWith('shared-account-')) {
    return User;
  }

  if (role === "inbox" || lowerName.includes("inbox")) return Inbox;
  if (role === "sent" || lowerName.includes("sent")) return Send;
  if (role === "drafts" || lowerName.includes("draft")) return File;
  if (role === "trash" || lowerName.includes("trash") || lowerName.includes("deleted")) return Trash2;
  if (role === "junk" || role === "spam" || lowerName.includes("junk") || lowerName.includes("spam")) return Ban;
  if (role === "archive" || lowerName.includes("archive")) return Archive;
  if (lowerName.includes("star") || lowerName.includes("flag")) return Star;

  if (hasChildren) {
    return isExpanded ? FolderOpen : Folder;
  }

  return Folder;
};

const ROLE_ICON_COLOR: Record<string, string> = {
  inbox: "text-blue-600/80 dark:text-blue-400/80",
  sent: "text-emerald-600/80 dark:text-emerald-400/80",
  drafts: "text-violet-600/80 dark:text-violet-400/80",
  trash: "text-muted-foreground",
  junk: "text-red-600/80 dark:text-red-400/80",
  archive: "text-amber-600/80 dark:text-amber-400/80",
};

function resolveRoleKey(role?: string, name?: string): string | undefined {
  const lowerName = name?.toLowerCase() || "";
  if (role === "inbox" || lowerName.includes("inbox")) return "inbox";
  if (role === "sent" || lowerName.includes("sent")) return "sent";
  if (role === "drafts" || lowerName.includes("draft")) return "drafts";
  if (role === "trash" || lowerName.includes("trash") || lowerName.includes("deleted")) return "trash";
  if (role === "junk" || role === "spam" || lowerName.includes("junk") || lowerName.includes("spam")) return "junk";
  if (role === "archive" || lowerName.includes("archive")) return "archive";
  return undefined;
}

function getIconClass(isSelected: boolean, isVirtual: boolean, _colorful: boolean, _roleKey?: string) {
  const base = "w-4 h-4 flex-shrink-0 transition-colors";
  if (isVirtual) return cn(base, "text-muted-foreground");
  return cn(base, isSelected ? "text-primary" : "text-muted-foreground");
}

function SidebarRowCounts({
  unread,
  total: _total,
  isSelected,
  onUnreadClick,
}: {
  unread?: number;
  total?: number;
  isSelected: boolean;
  onUnreadClick?: () => void;
}) {
  const unreadCount = unread ?? 0;
  if (unreadCount === 0) return null;

  const badgeClass = cn(
    "flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-semibold tabular-nums",
    isSelected
      ? "bg-primary text-primary-foreground"
      : "bg-primary/15 text-primary"
  );

  if (onUnreadClick) {
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); onUnreadClick(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onUnreadClick(); }
        }}
        className={cn(badgeClass, "cursor-pointer")}
        title={`${unreadCount} unread`}
      >
        {unreadCount > 99 ? "99+" : unreadCount}
      </span>
    );
  }

  return (
    <span className={badgeClass} title={`${unreadCount} unread`}>
      {unreadCount > 99 ? "99+" : unreadCount}
    </span>
  );
}

interface SidebarRowProps {
  icon: ReactNode;
  label: string;
  depth?: number;
  isSelected?: boolean;
  isVirtual?: boolean;
  unread?: number;
  total?: number;
  onClick?: () => void;
  hasChildren?: boolean;
  isExpanded?: boolean;
  onExpandToggle?: () => void;
  onUnreadClick?: () => void;
  isCollapsed: boolean;
  dropHandlers?: Record<string, unknown>;
  isValidDropTarget?: boolean;
  isInvalidDropTarget?: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
}

function SidebarRow({
  icon,
  label,
  depth = 0,
  isSelected = false,
  isVirtual = false,
  unread,
  total,
  onClick,
  hasChildren = false,
  isExpanded = false,
  onExpandToggle,
  onUnreadClick,
  isCollapsed,
  dropHandlers,
  isValidDropTarget,
  isInvalidDropTarget,
  onContextMenu,
}: SidebarRowProps) {
  const t = useTranslations('sidebar');
  const leftPad = isCollapsed ? 0 : ROW_PX_BASE + depth * INDENT_STEP;

  const rowContent = (
    <div
      {...(dropHandlers || {})}
      onContextMenu={onContextMenu}
      style={isCollapsed ? undefined : { paddingBlock: 'var(--density-sidebar-py)' }}
      className={cn(
        "group flex items-center text-sm transition-colors duration-150 rounded-lg",
        isCollapsed ? "justify-center w-10 h-10 mx-auto my-0.5" : "max-lg:min-h-[44px] mx-2 pr-2",
        isVirtual
          ? "text-muted-foreground"
          : isSelected
            ? "bg-primary/10 text-primary font-semibold"
            : "hover:bg-muted/50 text-muted-foreground",
        isValidDropTarget && "bg-primary/20 ring-2 ring-primary ring-inset",
        isInvalidDropTarget && "bg-destructive/10 ring-2 ring-destructive/30 ring-inset opacity-50"
      )}
    >
      {!isCollapsed && (
        <div
          className="flex items-center flex-shrink-0"
          style={{ paddingLeft: leftPad }}
        >
          {hasChildren && onExpandToggle ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onExpandToggle();
              }}
              className="flex items-center justify-center rounded hover:bg-muted active:bg-accent transition-colors"
              style={{ width: CHEVRON_SLOT, height: CHEVRON_SLOT }}
              title={isExpanded ? t('collapse_tooltip') : t('expand_tooltip')}
            >
              {isExpanded ? (
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-3 h-3 text-muted-foreground" />
              )}
            </button>
          ) : (
            <div style={{ width: CHEVRON_SLOT }} aria-hidden />
          )}
        </div>
      )}

      <button
        onClick={() => !isVirtual && onClick?.()}
        disabled={isVirtual}
        className={cn(
          "flex items-center min-w-0 transition-colors",
          isCollapsed ? "justify-center w-full h-full" : "gap-2 flex-1 text-left",
          isVirtual && "cursor-default select-none"
        )}
      >
        <span className="flex items-center justify-center flex-shrink-0 w-4 h-4">
          {icon}
        </span>
        {!isCollapsed && (
          <>
            <span className="flex-1 truncate">{label}</span>
            <SidebarRowCounts
              unread={unread}
              total={total}
              isSelected={isSelected}
              onUnreadClick={onUnreadClick}
            />
          </>
        )}
      </button>
    </div>
  );

  if (isCollapsed) {
    return (
      <Tooltip
        content={
          <div className="flex items-center gap-1.5">
            <span>{label}</span>
            {unread !== undefined && unread > 0 && (
              <span className="flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full text-[10px] font-semibold tabular-nums bg-primary/20 text-primary">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </div>
        }
        side="right"
      >
        {rowContent}
      </Tooltip>
    );
  }

  return rowContent;
}

function SidebarSectionHeader({
  label,
  expanded,
  onToggle,
  onSettings,
  settingsTitle,
  isCollapsed,
  first,
  icon,
  sub,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  onSettings?: () => void;
  settingsTitle?: string;
  isCollapsed: boolean;
  first?: boolean;
  icon?: ReactNode;
  sub?: boolean;
}) {
  if (isCollapsed) {
    return first ? null : <div className="h-px bg-border/50 mx-2 my-2" aria-hidden />;
  }

  const paddingY = sub ? "pt-2" : first ? "pt-3" : "pt-5";
  const paddingX = sub ? "px-4" : "px-3";
  const textClass = sub
    ? "text-xs font-semibold text-muted-foreground truncate"
    : "text-sm font-semibold text-foreground truncate";

  return (
    <button
      onClick={onToggle}
      className={cn(
        "group w-full flex items-center pb-1 select-none rounded-sm hover:bg-muted/40 transition-colors",
        paddingX,
        paddingY
      )}
    >
      {expanded ? (
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
      ) : (
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
      )}
      {icon && <span className="ml-1.5 flex-shrink-0">{icon}</span>}
      <span className={cn(textClass, icon ? "ml-1.5" : "ml-1.5")}>
        {label}
      </span>
      {onSettings && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onSettings();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onSettings();
            }
          }}
          className="ml-auto p-1 rounded text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          title={settingsTitle}
        >
          <Settings className="w-3.5 h-3.5" />
        </span>
      )}
    </button>
  );
}

function MailboxTreeItem({
  node,
  selectedMailbox,
  expandedFolders,
  onMailboxSelect,
  onToggleExpand,
  isCollapsed,
  onUnreadFilterClick,
  colorful,
  onContextMenu,
}: {
  node: MailboxNode;
  selectedMailbox: string;
  expandedFolders: Set<string>;
  onMailboxSelect?: (id: string) => void;
  onToggleExpand: (id: string) => void;
  isCollapsed: boolean;
  onUnreadFilterClick?: (mailboxId: string) => void;
  colorful: boolean;
  onContextMenu?: (e: React.MouseEvent, node: MailboxNode) => void;
}) {
  const tNotifications = useTranslations('notifications');
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedFolders.has(node.id);
  const Icon = getIconForMailbox(node.role, node.name, hasChildren, isExpanded, node.isShared, node.id);
  const isVirtualNode = node.id.startsWith('shared-');
  const isSelected = selectedMailbox === node.id;
  const roleKey = resolveRoleKey(node.role, node.name);

  const { isDragging: globalDragging } = useDragDropContext();
  const { dropHandlers, isValidDropTarget, isInvalidDropTarget } = useMailboxDrop({
    mailbox: node,
    onSuccess: (count, mailboxName) => {
      if (count === 1) {
        toast.success(
          tNotifications('email_moved'),
          tNotifications('moved_to_mailbox', { mailbox: mailboxName })
        );
      } else {
        toast.success(
          tNotifications('emails_moved', { count }),
          tNotifications('moved_to_mailbox', { mailbox: mailboxName })
        );
      }
    },
    onError: () => {
      toast.error(tNotifications('move_failed'), tNotifications('move_error'));
    },
  });

  return (
    <>
      <SidebarRow
        icon={<Icon className={getIconClass(isSelected, isVirtualNode, colorful, roleKey)} />}
        label={node.name}
        depth={node.depth}
        isSelected={isSelected}
        isVirtual={isVirtualNode}
        unread={node.unreadEmails}
        total={node.totalEmails}
        onClick={() => onMailboxSelect?.(node.id)}
        hasChildren={hasChildren}
        isExpanded={isExpanded}
        onExpandToggle={() => onToggleExpand(node.id)}
        onUnreadClick={() => onUnreadFilterClick?.(node.id)}
        isCollapsed={isCollapsed}
        dropHandlers={globalDragging ? (dropHandlers as Record<string, unknown>) : undefined}
        isValidDropTarget={isValidDropTarget}
        isInvalidDropTarget={isInvalidDropTarget}
        onContextMenu={onContextMenu && !isVirtualNode ? (e) => onContextMenu(e, node) : undefined}
      />

      {hasChildren && isExpanded && !isCollapsed && node.children.map((child) => (
        <MailboxTreeItem
          key={child.id}
          node={child}
          selectedMailbox={selectedMailbox}
          expandedFolders={expandedFolders}
          onMailboxSelect={onMailboxSelect}
          onToggleExpand={onToggleExpand}
          isCollapsed={isCollapsed}
          onUnreadFilterClick={onUnreadFilterClick}
          colorful={colorful}
          onContextMenu={onContextMenu}
        />
      ))}
    </>
  );
}

const TAG_ICON_COLOR: Record<string, string> = {
  red: "text-red-600/75 dark:text-red-400/75",
  orange: "text-orange-600/75 dark:text-orange-400/75",
  yellow: "text-yellow-600/75 dark:text-yellow-400/75",
  green: "text-green-600/75 dark:text-green-400/75",
  blue: "text-blue-600/75 dark:text-blue-400/75",
  purple: "text-purple-600/75 dark:text-purple-400/75",
  pink: "text-pink-600/75 dark:text-pink-400/75",
  teal: "text-teal-600/75 dark:text-teal-400/75",
  cyan: "text-cyan-600/75 dark:text-cyan-400/75",
  indigo: "text-indigo-600/75 dark:text-indigo-400/75",
  amber: "text-amber-600/75 dark:text-amber-400/75",
  lime: "text-lime-600/75 dark:text-lime-400/75",
  gray: "text-gray-500",
};

function TagItem({
  kw,
  isSelected,
  isCollapsed,
  onTagSelect,
  totalCount,
  unreadCount,
  colorful,
}: {
  kw: KeywordDefinition;
  isSelected: boolean;
  isCollapsed: boolean;
  onTagSelect?: (keywordId: string | null) => void;
  totalCount: number;
  unreadCount: number;
  colorful: boolean;
}) {
  const t = useTranslations('notifications');
  const palette = KEYWORD_PALETTE[kw.color];
  const { isDragging: globalDragging } = useDragDropContext();
  const { dropHandlers, isValidDropTarget } = useTagDrop({
    tagId: kw.id,
    onSuccess: (count, _tagLabel) => {
      if (count === 1) {
        toast.success(t('email_tagged'), kw.label);
      } else {
        toast.success(t('emails_tagged', { count }), kw.label);
      }
    },
    onError: () => {
      toast.error(t('tag_failed'), kw.label);
    },
  });

  const tagIcon = colorful ? (
    <Tag
      className={cn("w-4 h-4 flex-shrink-0", TAG_ICON_COLOR[kw.color] || "text-muted-foreground")}
      fill="currentColor"
    />
  ) : (
    <span className={cn("w-3 h-3 rounded-full", palette?.dot || "bg-gray-400")} />
  );

  return (
    <SidebarRow
      icon={tagIcon}
      label={kw.label}
      depth={0}
      isSelected={isSelected}
      unread={unreadCount}
      total={totalCount}
      onClick={() => onTagSelect?.(isSelected ? null : kw.id)}
      isCollapsed={isCollapsed}
      dropHandlers={globalDragging ? (dropHandlers as Record<string, unknown>) : undefined}
      isValidDropTarget={isValidDropTarget}
    />
  );
}

function DemoBanner() {
  const t = useTranslations('sidebar');
  const { isDemoMode, loginDemo } = useAuthStore();
  const { startTour, resetTourCompletion } = useTour();
  const router = useRouter();
  const [isResetting, setIsResetting] = useState(false);

  if (!isDemoMode) return null;

  const handleReset = async () => {
    setIsResetting(true);
    router.push('/');
    await loginDemo();
    setIsResetting(false);
  };

  const handleStartTour = () => {
    resetTourCompletion();
    router.push('/');
    setTimeout(() => startTour(), 100);
  };

  return (
    <div
      data-tour="demo-banner"
      className={cn(
        "flex flex-col gap-1.5 w-full px-3 py-2 text-xs",
        "bg-primary/10 dark:bg-primary/10 text-primary",
      )}
    >
      <div className="flex items-center gap-2">
        <FlaskConical className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate font-medium">{t("demo_banner")}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={handleStartTour}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 hover:bg-primary/20 transition-colors"
          title={t("demo_tour")}
        >
          <PlayCircle className="w-3 h-3" />
          {t("demo_tour")}
        </button>
        <button
          onClick={handleReset}
          disabled={isResetting}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 hover:bg-primary/20 transition-colors disabled:opacity-50"
          title={t("demo_reset")}
        >
          {isResetting ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RotateCcw className="w-3 h-3" />
          )}
          {t("demo_reset")}
        </button>
      </div>
    </div>
  );
}

function VacationBanner() {
  const t = useTranslations('sidebar');
  const router = useRouter();
  const { isEnabled, isSupported } = useVacationStore();

  if (!isSupported || !isEnabled) return null;

  return (
    <button
      onClick={() => router.push('/settings')}
      className={cn(
        "flex items-center gap-2 w-full px-3 py-2 text-xs",
        "bg-amber-500/10 dark:bg-amber-400/10 text-amber-700 dark:text-amber-400",
        "hover:bg-amber-500/15 dark:hover:bg-amber-400/15 transition-colors"
      )}
    >
      <Palmtree className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="truncate font-medium">{t("vacation_active")}</span>
      <Settings className="w-3 h-3 ml-auto flex-shrink-0 opacity-60" />
    </button>
  );
}

export function Sidebar({
  mailboxes = [],
  selectedMailbox = "",
  selectedKeyword = null,
  onMailboxSelect,
  onTagSelect,
  onCompose,
  onSidebarClose,
  onUnreadFilterClick,
  onMarkFolderRead,
  onMarkFolderTreeRead,
  onMarkAllFoldersRead,
  onEmptyFolder,
  onCreateSubfolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onImportEmail,
  onRefreshMailboxes,
  className,
  quota,
}: SidebarProps) {
  const router = useRouter();
  const { sidebarCollapsed: isCollapsed, toggleSidebarCollapsed } = useUIStore();
  const { primaryIdentity: _primaryIdentity } = useAuthStore();
  const pathname = usePathname();
  const { appLogoLightUrl, appLogoDarkUrl, appName } = useConfig();
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const defaultLogo = resolvedTheme === 'dark' ? '/branding/Inbox_Logo_White.svg' : '/branding/Inbox_Logo_Color.svg';
  const logoUrl = (resolvedTheme === 'dark'
    ? (appLogoDarkUrl || appLogoLightUrl)
    : (appLogoLightUrl || appLogoDarkUrl)) || defaultLogo;
  const [appNameBrand, ...appNameRestWords] = (appName || "Inbox Mail").split(" ");
  const appNameRest = appNameRestWords.join(" ");
  const { supportsCalendar } = useCalendarStore();
  const client = useAuthStore((s) => s.client);
  const supportsContacts = client?.supportsContacts() ?? false;
  const isSettingsActive = pathname.startsWith('/settings');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [foldersExpanded, setFoldersExpanded] = useState(() => {
    try {
      const stored = localStorage.getItem('sidebarFoldersExpanded');
      return stored !== null ? JSON.parse(stored) : true;
    } catch { return true; }
  });
  const [tagsExpanded, setTagsExpanded] = useState(() => {
    try {
      const stored = localStorage.getItem('sidebarTagsExpanded');
      return stored !== null ? JSON.parse(stored) : true;
    } catch { return true; }
  });
  const [unifiedExpanded, setUnifiedExpanded] = useState(() => {
    try {
      const stored = localStorage.getItem('sidebarUnifiedExpanded');
      return stored !== null ? JSON.parse(stored) : true;
    } catch { return true; }
  });
  const [sharedExpanded, setSharedExpanded] = useState(() => {
    try {
      const stored = localStorage.getItem('sidebarSharedExpanded');
      return stored !== null ? JSON.parse(stored) : false;
    } catch { return false; }
  });
  const [expandedSharedAccounts, setExpandedSharedAccounts] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('sidebarExpandedSharedAccounts');
      return stored !== null ? new Set(JSON.parse(stored) as string[]) : new Set();
    } catch { return new Set(); }
  });
  const emailKeywords = useSettingsStore(s => s.emailKeywords);
  const hideAccountSwitcher = useSettingsStore(s => s.hideAccountSwitcher);
  const enableUnifiedMailbox = useSettingsStore(s => s.enableUnifiedMailbox);
  const colorfulSidebarIcons = useSettingsStore(s => s.colorfulSidebarIcons);
  const tagCounts = useEmailStore(s => s.tagCounts);
  const accounts = useAccountStore(s => s.accounts);
  const connectedAccounts = accounts.filter(a => a.isConnected);
  const showUnified = enableUnifiedMailbox && connectedAccounts.length > 1;
  const { unifiedCounts } = useEmailStore();
  const t = useTranslations('sidebar');

  useEffect(() => {
    const stored = localStorage.getItem('expandedMailboxes');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setExpandedFolders(new Set(parsed));
      } catch (e) {
        debug.error('Failed to parse expanded mailboxes:', e);
      }
    } else {
      const tree = buildMailboxTree(mailboxes);
      const collectExpandable = (nodes: MailboxNode[]): string[] => {
        const ids: string[] = [];
        for (const node of nodes) {
          if (node.children.length > 0) {
            ids.push(node.id);
            ids.push(...collectExpandable(node.children));
          }
        }
        return ids;
      };
      setExpandedFolders(new Set(collectExpandable(tree)));
    }
  }, [mailboxes]);

  const handleToggleExpand = (mailboxId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(mailboxId)) {
        next.delete(mailboxId);
      } else {
        next.add(mailboxId);
      }
      try {
        localStorage.setItem('expandedMailboxes', JSON.stringify(Array.from(next)));
      } catch { /* storage full or unavailable */ }
      return next;
    });
  };

  const mailboxTree = buildMailboxTree(mailboxes);
  const ownTree = mailboxTree.filter(n => !n.id.startsWith('shared-account-'));
  const sharedAccounts = mailboxTree.filter(n => n.id.startsWith('shared-account-'));

  const getUnifiedIcon = (role: UnifiedMailboxRole) => {
    switch (role) {
      case 'inbox': return Inbox;
      case 'sent': return Send;
      case 'drafts': return File;
      case 'trash': return Trash2;
      case 'archive': return Archive;
      case 'junk': return Ban;
      default: return Folder;
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedMailbox || isCollapsed) return;

      const findNode = (nodes: MailboxNode[]): MailboxNode | null => {
        for (const node of nodes) {
          if (node.id === selectedMailbox) return node;
          const found = findNode(node.children);
          if (found) return found;
        }
        return null;
      };

      const selectedNode = findNode(mailboxTree);
      if (!selectedNode) return;

      if (e.key === 'ArrowRight' && selectedNode.children.length > 0) {
        if (!expandedFolders.has(selectedMailbox)) {
          handleToggleExpand(selectedMailbox);
        }
      } else if (e.key === 'ArrowLeft' && selectedNode.children.length > 0) {
        if (expandedFolders.has(selectedMailbox)) {
          handleToggleExpand(selectedMailbox);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedMailbox, isCollapsed, expandedFolders, mailboxTree]);

  const toggleUnified = () => {
    setUnifiedExpanded((prev: boolean) => {
      const next = !prev;
      try { localStorage.setItem('sidebarUnifiedExpanded', JSON.stringify(next)); } catch { /* */ }
      return next;
    });
  };
  const toggleFolders = () => {
    setFoldersExpanded((prev: boolean) => {
      const next = !prev;
      try { localStorage.setItem('sidebarFoldersExpanded', JSON.stringify(next)); } catch { /* */ }
      return next;
    });
  };
  const toggleTags = () => {
    setTagsExpanded((prev: boolean) => {
      const next = !prev;
      try { localStorage.setItem('sidebarTagsExpanded', JSON.stringify(next)); } catch { /* */ }
      return next;
    });
  };
  const toggleShared = () => {
    setSharedExpanded((prev: boolean) => {
      const next = !prev;
      try { localStorage.setItem('sidebarSharedExpanded', JSON.stringify(next)); } catch { /* */ }
      return next;
    });
  };
  const toggleSharedAccount = (id: string) => {
    setExpandedSharedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem('sidebarExpandedSharedAccounts', JSON.stringify(Array.from(next))); } catch { /* */ }
      return next;
    });
  };

  const openFolderSettings = () => {
    try { localStorage.setItem('settings-active-tab', 'folders'); } catch { /* */ }
    router.push('/settings');
  };
  const openKeywordSettings = () => {
    try { localStorage.setItem('settings-active-tab', 'keywords'); } catch { /* */ }
    router.push('/settings');
  };

  const {
    contextMenu: mailboxContextMenu,
    openContextMenu: openMailboxContextMenu,
    closeContextMenu: closeMailboxContextMenu,
    menuRef: mailboxMenuRef,
  } = useContextMenu<MailboxContextTarget>();

  const handleMailboxContextMenu = (e: React.MouseEvent, node: MailboxNode) => {
    const mailbox = mailboxes.find(mb => mb.id === node.id);
    if (!mailbox) return;
    openMailboxContextMenu(e, { kind: "mailbox", mailbox, hasChildren: node.children.length > 0 });
  };

  const handleFoldersHeaderContextMenu = (e: React.MouseEvent) => {
    openMailboxContextMenu(e, { kind: "folders-section" });
  };

  return (
    <div
      className={cn(
        "relative flex flex-col h-full border-r transition-all duration-300 overflow-hidden",
        "bg-background border-border",
        "max-lg:w-full",
        isCollapsed ? "lg:w-16" : "lg:w-full",
        className
      )}
    >
      {/* Header — logo + app name + collapse toggle */}
      {/* This is the mobile drawer's own top edge (rendered inside a `fixed`
          overlay in page.tsx, escaping body's safe-area padding entirely),
          with its close (X) button right here — pt- replaces py-3's top half
          with an addition on top of it rather than a plain class stacked
          alongside py-3, which would risk losing to it on specificity/order.
          Inert on desktop/web: env() is 0 there. */}
      <div className={cn(
        "flex items-center border-b border-border flex-shrink-0",
        isCollapsed
          ? "justify-center px-0 py-2.5"
          : "gap-2 px-3 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))]"
      )}>
        {/* Mobile close */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onSidebarClose}
          className="lg:hidden h-8 w-8 flex-shrink-0"
          aria-label={t("close")}
        >
          <X className="w-4 h-4" />
        </Button>

        {/* Logo */}
        {logoUrl && !isCollapsed && (
          <img src={logoUrl} alt="Logo" className="w-7 h-7 object-contain flex-shrink-0" />
        )}

        {/* App name (hidden when collapsed) */}
        {!isCollapsed && (
          <span className="text-sm font-semibold flex-1 truncate">
            <span className="text-info">{appNameBrand}</span>
            {appNameRest && <span className="text-foreground"> {appNameRest}</span>}
          </span>
        )}

        {/* Desktop collapse toggle */}
        <Tooltip
          content={t("expand_tooltip")}
          disabled={!isCollapsed}
          side="right"
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebarCollapsed}
            className={cn(
              "hidden lg:flex flex-shrink-0",
              isCollapsed ? "h-10 w-10 mx-auto" : "h-7 w-7 ml-auto"
            )}
            title={!isCollapsed ? t("collapse_tooltip") : undefined}
          >
            {isCollapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
          </Button>
        </Tooltip>
      </div>

      {/* Compose button */}
      <div className={cn("px-3 py-2.5 flex-shrink-0", isCollapsed && "flex justify-center px-1")}>
        <Tooltip
          content={t("compose")}
          disabled={!isCollapsed}
          side="right"
        >
          <button
            onClick={onCompose}
            className={cn(
              "flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-full font-medium text-sm transition-colors hover:bg-primary/90 active:bg-primary/80 shadow-sm",
              isCollapsed ? "w-10 h-10" : "w-full px-4 py-2.5"
            )}
          >
            <Pencil className="w-4 h-4 flex-shrink-0" />
            {!isCollapsed && <span>{t("compose")}</span>}
          </button>
        </Tooltip>
      </div>

      {!isCollapsed && <DemoBanner />}
      {!isCollapsed && <VacationBanner />}

      {/* Mailbox List */}
      <div className="flex-1 overflow-y-auto" data-tour="sidebar">
        {showUnified && (
          <div>
            <SidebarSectionHeader
              label={t("all_accounts")}
              expanded={unifiedExpanded}
              onToggle={toggleUnified}
              isCollapsed={isCollapsed}
              first
            />
            {((unifiedExpanded && !isCollapsed) || isCollapsed) && (
              <>
                {unifiedCounts.map((count) => {
                  const unifiedId = UNIFIED_MAILBOX_IDS[count.role];
                  const Icon = getUnifiedIcon(count.role);
                  const isSelected = !selectedKeyword && selectedMailbox === unifiedId;
                  return (
                    <SidebarRow
                      key={unifiedId}
                      icon={<Icon className={getIconClass(isSelected, false, colorfulSidebarIcons, count.role)} />}
                      label={t(`unified_${count.role}`)}
                      depth={0}
                      isSelected={isSelected}
                      unread={count.unreadEmails}
                      total={count.totalEmails}
                      onClick={() => onMailboxSelect?.(unifiedId)}
                      isCollapsed={isCollapsed}
                    />
                  );
                })}
              </>
            )}
          </div>
        )}

        <div onContextMenu={handleFoldersHeaderContextMenu}>
          {mailboxes.length === 0 ? (
            <div className="px-4 py-2 text-sm text-muted-foreground">
              {!isCollapsed && t("loading_mailboxes")}
            </div>
          ) : (
            ownTree.map((node) => (
              <MailboxTreeItem
                key={node.id}
                node={node}
                selectedMailbox={selectedKeyword ? "" : selectedMailbox}
                expandedFolders={expandedFolders}
                onMailboxSelect={onMailboxSelect}
                onToggleExpand={handleToggleExpand}
                isCollapsed={isCollapsed}
                onUnreadFilterClick={onUnreadFilterClick}
                colorful={colorfulSidebarIcons}
                onContextMenu={handleMailboxContextMenu}
              />
            ))
          )}
        </div>

        {sharedAccounts.length > 0 && (
          <div>
            <SidebarSectionHeader
              label={t("shared")}
              expanded={sharedExpanded}
              onToggle={toggleShared}
              isCollapsed={isCollapsed}
            />
            {((sharedExpanded && !isCollapsed) || isCollapsed) && (
              <>
                {sharedAccounts.map((account) => {
                  const accountExpanded = expandedSharedAccounts.has(account.id);
                  return (
                    <div key={account.id}>
                      <SidebarSectionHeader
                        label={account.name}
                        expanded={accountExpanded}
                        onToggle={() => toggleSharedAccount(account.id)}
                        isCollapsed={isCollapsed}
                        sub
                        icon={<User className="w-3.5 h-3.5 text-muted-foreground" />}
                      />
                      {accountExpanded && !isCollapsed && account.children.map((child) => (
                        <MailboxTreeItem
                          key={child.id}
                          node={child}
                          selectedMailbox={selectedKeyword ? "" : selectedMailbox}
                          expandedFolders={expandedFolders}
                          onMailboxSelect={onMailboxSelect}
                          onToggleExpand={handleToggleExpand}
                          isCollapsed={isCollapsed}
                          onUnreadFilterClick={onUnreadFilterClick}
                          colorful={colorfulSidebarIcons}
                          onContextMenu={handleMailboxContextMenu}
                        />
                      ))}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* App navigation: Calendar, Contacts, Settings — above labels */}
        <div className="mt-1">
            {supportsCalendar && (() => {
              const isActive = pathname === '/calendar' || pathname.startsWith('/calendar/');
              return (
                <Tooltip content={t("calendar")} disabled={!isCollapsed} side="right">
                  <Link
                    href="/calendar"
                    style={isCollapsed ? undefined : { paddingBlock: 'var(--density-sidebar-py)' }}
                    className={cn(
                      "flex items-center text-sm transition-colors duration-150 rounded-lg",
                      isCollapsed ? "justify-center w-10 h-10 mx-auto my-0.5" : "mx-2 pr-2",
                      isActive
                        ? "bg-primary/10 text-primary font-semibold"
                        : "hover:bg-muted/50 text-muted-foreground",
                    )}
                  >
                    {!isCollapsed && <div style={{ width: ROW_PX_BASE + CHEVRON_SLOT }} className="flex-shrink-0" />}
                    <span className={cn("flex items-center min-w-0", isCollapsed ? "justify-center w-full h-full" : "gap-2 flex-1")}>
                      <span className="flex items-center justify-center flex-shrink-0 w-4 h-4">
                        <Calendar className={cn("w-4 h-4", isActive ? "text-primary" : "text-muted-foreground")} />
                      </span>
                      {!isCollapsed && <span className="flex-1 truncate">{t("calendar")}</span>}
                    </span>
                  </Link>
                </Tooltip>
              );
            })()}
            {supportsContacts && (() => {
              const isActive = pathname === '/contacts' || pathname.startsWith('/contacts/');
              return (
                <Tooltip content={t("contacts")} disabled={!isCollapsed} side="right">
                  <Link
                    href="/contacts"
                    style={isCollapsed ? undefined : { paddingBlock: 'var(--density-sidebar-py)' }}
                    className={cn(
                      "flex items-center text-sm transition-colors duration-150 rounded-lg",
                      isCollapsed ? "justify-center w-10 h-10 mx-auto my-0.5" : "mx-2 pr-2",
                      isActive
                        ? "bg-primary/10 text-primary font-semibold"
                        : "hover:bg-muted/50 text-muted-foreground",
                    )}
                  >
                    {!isCollapsed && <div style={{ width: ROW_PX_BASE + CHEVRON_SLOT }} className="flex-shrink-0" />}
                    <span className={cn("flex items-center min-w-0", isCollapsed ? "justify-center w-full h-full" : "gap-2 flex-1")}>
                      <span className="flex items-center justify-center flex-shrink-0 w-4 h-4">
                        <BookUser className={cn("w-4 h-4", isActive ? "text-primary" : "text-muted-foreground")} />
                      </span>
                      {!isCollapsed && <span className="flex-1 truncate">{t("contacts")}</span>}
                    </span>
                  </Link>
                </Tooltip>
              );
            })()}
            {(() => {
              const isActive = pathname === '/settings' || pathname.startsWith('/settings/');
              return (
                <Tooltip content={t("settings")} disabled={!isCollapsed} side="right">
                  <Link
                    href="/settings"
                    style={isCollapsed ? undefined : { paddingBlock: 'var(--density-sidebar-py)' }}
                    className={cn(
                      "flex items-center text-sm transition-colors duration-150 rounded-lg",
                      isCollapsed ? "justify-center w-10 h-10 mx-auto my-0.5" : "mx-2 pr-2",
                      isActive
                        ? "bg-primary/10 text-primary font-semibold"
                        : "hover:bg-muted/50 text-muted-foreground",
                    )}
                  >
                    {!isCollapsed && <div style={{ width: ROW_PX_BASE + CHEVRON_SLOT }} className="flex-shrink-0" />}
                    <span className={cn("flex items-center min-w-0", isCollapsed ? "justify-center w-full h-full" : "gap-2 flex-1")}>
                      <span className="flex items-center justify-center flex-shrink-0 w-4 h-4">
                        <Settings className={cn("w-4 h-4", isActive ? "text-primary" : "text-muted-foreground")} />
                      </span>
                      {!isCollapsed && <span className="flex-1 truncate">{t("settings")}</span>}
                    </span>
                  </Link>
                </Tooltip>
              );
            })()}
          </div>

        {emailKeywords.length > 0 && (
          <div data-tour="keyword-tags">
            <SidebarSectionHeader
              label={t("tags")}
              expanded={tagsExpanded}
              onToggle={toggleTags}
              onSettings={openKeywordSettings}
              settingsTitle={t('settings')}
              isCollapsed={isCollapsed}
            />
            {((tagsExpanded && !isCollapsed) || isCollapsed) && (
              <>
                {emailKeywords.map((kw) => (
                  <TagItem
                    key={kw.id}
                    kw={kw}
                    isSelected={selectedKeyword === kw.id}
                    isCollapsed={isCollapsed}
                    onTagSelect={onTagSelect}
                    totalCount={tagCounts[kw.id]?.total ?? 0}
                    unreadCount={tagCounts[kw.id]?.unread ?? 0}
                    colorful={colorfulSidebarIcons}
                  />
                ))}
              </>
            )}
          </div>
        )}

        {!isCollapsed && <PluginSlot name="sidebar-widget" className="border-t border-border" />}
      </div>

      {!isCollapsed && quota !== null && quota !== undefined && quota.used > 0 && (() => {
        const usedGB = (quota.used / 1073741824).toFixed(1);
        const hasLimit = quota.total > 0;
        const totalGB = hasLimit ? (quota.total / 1073741824).toFixed(1) : null;
        const pct = hasLimit ? Math.min(100, (quota.used / quota.total) * 100) : 0;
        const barColor = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-green-500";
        return (
          <div className="px-3 py-2.5 flex-shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-muted-foreground">{t("storage")}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {totalGB ? `${usedGB} / ${totalGB} GB` : `${usedGB} GB used`}
              </span>
            </div>
            {hasLimit && (
              <div className="w-full bg-muted rounded-full h-1.5">
                <div
                  className={cn("h-1.5 rounded-full transition-all", barColor)}
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
        );
      })()}

      {/* Settings row at bottom — only shown standalone when the account switcher (which now
          hosts a Settings entry of its own) is hidden */}
      {hideAccountSwitcher && (
        <div className={cn("flex-shrink-0", isCollapsed ? "flex justify-center py-1.5" : "px-2 py-1.5")}>
          <Tooltip content={t("settings")} disabled={!isCollapsed} side="right">
            <Link
              href="/settings"
              className={cn(
                "flex items-center gap-2 rounded-lg text-sm transition-colors duration-150",
                isCollapsed
                  ? "w-10 h-10 justify-center"
                  : "w-full px-2 py-1.5",
                isSettingsActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Settings className="w-4 h-4 flex-shrink-0" />
              {!isCollapsed && <span>{t("settings")}</span>}
            </Link>
          </Tooltip>
        </div>
      )}

      {/* Account / profile section — avatar + name + email for switching */}
      {!hideAccountSwitcher && (
        <div className={cn("flex-shrink-0", isCollapsed ? "flex justify-center py-1.5 px-1" : "px-2 py-2")}>
          <AccountSwitcher
            variant={isCollapsed ? "rail" : "expanded"}
            popoverDirection="up"
            className={isCollapsed ? undefined : "w-full"}
          />
        </div>
      )}

      <MailboxContextMenu
        target={mailboxContextMenu.data}
        position={mailboxContextMenu.position}
        isOpen={mailboxContextMenu.isOpen}
        onClose={closeMailboxContextMenu}
        menuRef={mailboxMenuRef}
        mailboxes={mailboxes}
        onMarkFolderRead={onMarkFolderRead}
        onMarkFolderTreeRead={onMarkFolderTreeRead}
        onMarkAllFoldersRead={onMarkAllFoldersRead}
        onEmptyFolder={onEmptyFolder}
        onCreateSubfolder={onCreateSubfolder}
        onCreateFolder={onCreateFolder}
        onRenameFolder={onRenameFolder}
        onDeleteFolder={onDeleteFolder}
        onImportEmail={onImportEmail}
        onRefresh={onRefreshMailboxes}
      />
    </div>
  );
}
