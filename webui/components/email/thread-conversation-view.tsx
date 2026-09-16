"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import { Email, ThreadGroup } from "@/lib/jmap/types";
import { deduplicateEmails, cleanThreadSubject } from "@/lib/thread-utils";
import { EMAIL_SANITIZE_CONFIG, collapseBlockedImageContainers, plainTextToSafeHtml } from "@/lib/email-sanitization";
import { hasMeaningfulHtmlBody } from "@/lib/signature-utils";
import { transformInlineStyles, transformColorForDarkMode, transformBgColorForDarkMode } from "@/lib/color-transform";
import { useThemeStore } from "@/stores/theme-store";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { formatDateDetailed, formatThreadDate, formatFileSize, cn } from "@/lib/utils";
import {
  ArrowLeft,
  Reply,
  ReplyAll,
  Forward,
  Paperclip,
  Star,
  Download,
  Loader2,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  File,
  Eye,
  Undo2,
  MoreHorizontal,
  ChevronDown,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useSettingsStore } from "@/stores/settings-store";
import { useContactStore } from "@/stores/contact-store";
import { useAuthStore } from "@/stores/auth-store";
import { useAccountStore } from "@/stores/account-store";
import { useEmailStore } from "@/stores/email-store";
import { isFilePreviewable } from "@/lib/file-preview";

interface ThreadConversationViewProps {
  thread: ThreadGroup;
  emails: Email[];
  isLoading?: boolean;
  onBack: () => void;
  onReply?: (email: Email) => void;
  onReplyAll?: (email: Email) => void;
  onForward?: (email: Email) => void;
  onDownloadAttachment?: (blobId: string, name: string, type?: string) => void;
  onMarkAsRead?: (emailId: string, read: boolean) => void;
  onRestoreToInbox?: () => void;
}

const getFileIcon = (name?: string, type?: string) => {
  const ext = name?.split('.').pop()?.toLowerCase();
  const mimeType = type?.toLowerCase();
  if (mimeType?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext || '')) return FileImage;
  if (mimeType?.startsWith('video/') || ['mp4', 'avi', 'mov', 'wmv'].includes(ext || '')) return FileVideo;
  if (mimeType?.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac'].includes(ext || '')) return FileAudio;
  if (mimeType === 'application/pdf' || ext === 'pdf') return FileText;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext || '')) return FileArchive;
  return File;
};

export function ThreadConversationView({
  thread,
  emails,
  isLoading = false,
  onBack,
  onReply,
  onReplyAll,
  onForward,
  onDownloadAttachment,
  onMarkAsRead,
  onRestoreToInbox,
}: ThreadConversationViewProps) {
  const t = useTranslations();
  const externalContentPolicy = useSettingsStore((state) => state.externalContentPolicy);
  const addTrustedSender = useSettingsStore((state) => state.addTrustedSender);
  const isSenderTrusted = useSettingsStore((state) => state.isSenderTrusted);
  const trustedSendersAddressBook = useSettingsStore((state) => state.trustedSendersAddressBook);
  const isTrustedAddressBookSender = useContactStore((state) => state.isTrustedAddressBookSender);
  const addToTrustedSendersBook = useContactStore((state) => state.addToTrustedSendersBook);
  const { client } = useAuthStore();
  const activeAccountId = useAuthStore((state) => state.activeAccountId);
  const accounts = useAccountStore((state) => state.accounts);
  const activeAccount = accounts.find((a) => a.id === activeAccountId);
  const currentUserEmail = (activeAccount?.email || activeAccount?.username || "").toLowerCase();

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [allowExternalContent, setAllowExternalContent] = useState<Set<string>>(new Set());
  const [showAllEmails, setShowAllEmails] = useState(false);

  // Deduplicate emails (e.g. self-sent emails that exist in both Sent and Inbox)
  const uniqueEmails = useMemo(() => deduplicateEmails(emails), [emails]);

  // emails arrive oldest-first from getThreadEmails — no need to reverse
  // In Gmail, only the newest email is expanded by default; earlier emails are collapsed into compact single-line rows.
  useEffect(() => {
    if (uniqueEmails.length > 0) {
      const idsToExpand = new Set<string>();
      const newest = uniqueEmails[uniqueEmails.length - 1];
      if (newest) idsToExpand.add(newest.id);

      // If the thread is partially read, expand unread incoming emails
      const allUnread = uniqueEmails.every((e) => !e.keywords?.$seen);
      if (!allUnread) {
        uniqueEmails.forEach((email) => {
          const fromEmail = email.from?.[0]?.email?.toLowerCase() || "";
          const isFromMe = !!currentUserEmail && fromEmail === currentUserEmail;
          if (!isFromMe && !email.keywords?.$seen) {
            idsToExpand.add(email.id);
          }
        });
      }

      setExpandedIds(idsToExpand);
      setShowAllEmails(false);
    }
  }, [uniqueEmails, currentUserEmail]);

  const toggleExpanded = (emailId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(emailId)) next.delete(emailId); else next.add(emailId);
      return next;
    });
  };

  const toggleAllowExternal = (emailId: string) => {
    setAllowExternalContent(prev => { const next = new Set(prev); next.add(emailId); return next; });
  };

  // newest email is last in sorted array — used for bottom reply pills
  const latestEmail = uniqueEmails[uniqueEmails.length - 1];

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("threads.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 sticky top-0 z-10" style={{ paddingTop: 'calc(var(--density-header-py) + env(safe-area-inset-top, 0px))', paddingBottom: 'var(--density-header-py)' }}>
        <button onClick={onBack} className="p-2 -ml-2 rounded-full hover:bg-muted transition-colors flex-shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="flex-1 min-w-0 font-semibold text-foreground truncate text-base">
          {cleanThreadSubject(thread.latestEmail.subject) || thread.latestEmail.subject || t("email_viewer.no_subject")}
        </h1>
        {onRestoreToInbox && (
          <Button variant="outline" size="sm" onClick={onRestoreToInbox} className="flex-shrink-0 gap-1.5">
            <Undo2 className="w-4 h-4" />
            Restore
          </Button>
        )}
      </div>

      {/* Thread emails */}
      <div className="flex-1 overflow-y-auto min-h-0 pb-[env(safe-area-inset-bottom,0px)]">
        <div className="py-2">
          {(() => {
            const collapseMiddle = !showAllEmails && uniqueEmails.length > 3;
            const hiddenCount = collapseMiddle ? uniqueEmails.length - 2 : 0;
            const visibleEmails = collapseMiddle
              ? [uniqueEmails[0], uniqueEmails[uniqueEmails.length - 1]]
              : uniqueEmails;

            return visibleEmails.map((email, visibleIndex) => {
              const originalIndex = collapseMiddle && visibleIndex === 1 ? uniqueEmails.length - 1 : visibleIndex;
              const senderEmail = email.from?.[0]?.email?.toLowerCase();
              const senderIsTrusted = senderEmail
                ? isSenderTrusted(senderEmail) || (trustedSendersAddressBook && isTrustedAddressBookSender(senderEmail))
                : false;
              const isLast = originalIndex === uniqueEmails.length - 1;
              return (
                <div key={email.id}>
                  {collapseMiddle && visibleIndex === 1 && (
                    <button
                      type="button"
                      onClick={() => setShowAllEmails(true)}
                      className="flex items-center gap-1.5 mx-4 my-1 px-3 h-7 rounded-full border border-border bg-muted hover:bg-muted/70 text-muted-foreground text-xs font-medium transition-colors"
                    >
                      <span className="text-base leading-none tracking-widest">···</span>
                      <span>{hiddenCount} more message{hiddenCount !== 1 ? 's' : ''}</span>
                    </button>
                  )}
                  <EmailCard
                    email={email}
                    isExpanded={expandedIds.has(email.id)}
                    isLast={isLast}
                    allowExternal={externalContentPolicy === 'allow' || senderIsTrusted || allowExternalContent.has(email.id)}
                    onToggleExpanded={() => toggleExpanded(email.id)}
                    onAllowExternal={() => toggleAllowExternal(email.id)}
                    onTrustSender={senderEmail ? () => {
                      if (trustedSendersAddressBook && client) {
                        addToTrustedSendersBook(client, senderEmail).catch(console.error);
                      } else {
                        addTrustedSender(senderEmail);
                      }
                      toggleAllowExternal(email.id);
                    } : undefined}
                    onReply={onReply ? () => onReply(email) : undefined}
                    onReplyAll={onReplyAll ? () => onReplyAll(email) : undefined}
                    onForward={onForward ? () => onForward(email) : undefined}
                    onDownloadAttachment={onDownloadAttachment}
                    onMarkAsRead={onMarkAsRead}
                  />
                </div>
              );
            });
          })()}
        </div>

        {/* Gmail-style pill Reply / Reply All / Forward at bottom */}
        {latestEmail && (onReply || onReplyAll || onForward) && (
          <div className="flex items-center gap-3 px-6 py-5 border-t border-border">
            {onReply && (
              <button
                onClick={() => onReply(latestEmail)}
                className="flex items-center gap-2 px-5 py-2 rounded-full border border-border hover:bg-muted transition-colors text-sm font-medium text-foreground"
              >
                <Reply className="w-4 h-4" />
                {t("email_viewer.reply")}
              </button>
            )}
            {onReplyAll && (
              <button
                onClick={() => onReplyAll(latestEmail)}
                className="flex items-center gap-2 px-5 py-2 rounded-full border border-border hover:bg-muted transition-colors text-sm font-medium text-foreground"
              >
                <ReplyAll className="w-4 h-4" />
                {t("email_viewer.reply_all")}
              </button>
            )}
            {onForward && (
              <button
                onClick={() => onForward(latestEmail)}
                className="flex items-center gap-2 px-5 py-2 rounded-full border border-border hover:bg-muted transition-colors text-sm font-medium text-foreground"
              >
                <Forward className="w-4 h-4" />
                {t("email_viewer.forward")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export interface EmailCardProps {
  email: Email;
  isExpanded: boolean;
  isLast: boolean;
  allowExternal: boolean;
  onToggleExpanded: () => void;
  onAllowExternal: () => void;
  onTrustSender?: () => void;
  onReply?: () => void;
  onReplyAll?: () => void;
  onForward?: () => void;
  onDownloadAttachment?: (blobId: string, name: string, type?: string) => void;
  onMarkAsRead?: (emailId: string, read: boolean) => void;
}

export function EmailCard({
  email,
  isExpanded,
  isLast,
  allowExternal,
  onToggleExpanded,
  onAllowExternal,
  onTrustSender,
  onReply,
  onReplyAll,
  onForward,
  onDownloadAttachment,
  onMarkAsRead,
}: EmailCardProps) {
  const t = useTranslations();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const density = useSettingsStore((state) => state.density);
  const mailAttachmentAction = useSettingsStore((state) => state.mailAttachmentAction);
  const hideInlineImageAttachments = useSettingsStore((state) => state.hideInlineImageAttachments);
  const emailAlwaysLightMode = useSettingsStore((state) => state.emailAlwaysLightMode);
  const sender = email.from?.[0];
  const isUnread = !email.keywords?.$seen;
  const activeAccountId = useAuthStore((state) => state.activeAccountId);
  const accounts = useAccountStore((state) => state.accounts);
  const activeAccount = accounts.find((a) => a.id === activeAccountId);
  const currentUserEmail = (activeAccount?.email || activeAccount?.username || "").toLowerCase();

  const [isStarred, setIsStarred] = useState(!!email.keywords?.$flagged);
  const [showDetails, setShowDetails] = useState(false);
  const detailsRef = useRef<HTMLDivElement>(null);
  const [hasBlockedContent, setHasBlockedContent] = useState(false);
  const [cidBlobUrls, setCidBlobUrls] = useState<Record<string, string>>({});
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const { client } = useAuthStore();

  useEffect(() => {
    setIsStarred(!!email.keywords?.$flagged);
  }, [email.keywords?.$flagged]);

  const handleToggleStar = async () => {
    const nextStarred = !isStarred;
    setIsStarred(nextStarred);
    if (client) {
      try {
        await useEmailStore.getState().toggleStar(client, email.id);
      } catch (e) {
        console.error('Failed to toggle star:', e);
        setIsStarred(!nextStarred);
      }
    }
  };

  // Close details dropdown on outside click
  useEffect(() => {
    if (!showDetails) return;
    const handler = (e: MouseEvent) => {
      if (detailsRef.current && !detailsRef.current.contains(e.target as Node)) {
        setShowDetails(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDetails]);

  // Snippet preview for collapsed single-line row
  const snippet = useMemo(() => {
    if (email.preview) return email.preview.trim();
    if (email.textBody?.[0]?.partId && email.bodyValues?.[email.textBody[0].partId]) {
      return email.bodyValues[email.textBody[0].partId].value.replace(/\s+/g, ' ').trim();
    }
    return '';
  }, [email.preview, email.textBody, email.bodyValues]);

  // Clean "to me" label matching Gmail
  const toLabel = useMemo(() => {
    const recipients = email.to || [];
    if (recipients.length === 0) return "me";
    const isMe = (addr?: string) => !!addr && !!currentUserEmail && addr.toLowerCase() === currentUserEmail;

    if (recipients.length === 1) {
      return isMe(recipients[0].email) ? "me" : (recipients[0].name || recipients[0].email || "me");
    }

    const hasMe = recipients.some(r => isMe(r.email));
    if (hasMe) {
      const others = recipients.filter(r => !isMe(r.email));
      const otherName = others[0]?.name || others[0]?.email;
      return `me${otherName ? `, ${otherName}` : ''}${others.length > 1 ? ` +${others.length - 1}` : ''}`;
    }

    return `${recipients[0]?.name || recipients[0]?.email}${recipients.length > 1 ? ` +${recipients.length - 1}` : ''}`;
  }, [email.to, currentUserEmail]);

  // Close more menu on outside click
  useEffect(() => {
    if (!showMoreMenu) return;
    const handler = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMoreMenu]);

  // Recipients display
  const toRecipients = email.to?.map(r => r.name || r.email).join(', ') || '';

  // Mark as read when expanded
  useEffect(() => {
    if (!isExpanded || !onMarkAsRead || email.keywords?.$seen) return;
    const markAsReadDelay = useSettingsStore.getState().markAsReadDelay;
    if (markAsReadDelay === -1) return;
    if (markAsReadDelay === 0) { onMarkAsRead(email.id, true); return; }
    const timeout = setTimeout(() => onMarkAsRead(email.id, true), markAsReadDelay);
    return () => clearTimeout(timeout);
  }, [isExpanded, email.id, email.keywords?.$seen, onMarkAsRead]);

  // Fetch inline CID images
  useEffect(() => {
    if (!client || !email?.attachments) { setCidBlobUrls({}); return; }
    const cidAttachments = email.attachments.filter(att => att.cid && att.blobId);
    if (cidAttachments.length === 0) { setCidBlobUrls({}); return; }
    let cancelled = false;
    const objectUrls: string[] = [];
    async function fetchCidBlobs() {
      const urls: Record<string, string> = {};
      await Promise.all(cidAttachments.map(async (att) => {
        const cidValue = att.cid!.replace(/^<|>$/g, '');
        try {
          const objectUrl = await client!.fetchBlobAsObjectUrl(att.blobId, att.name || 'inline', att.type);
          if (!cancelled) { urls[cidValue] = objectUrl; objectUrls.push(objectUrl); }
          else URL.revokeObjectURL(objectUrl);
        } catch { /* skip */ }
      }));
      if (!cancelled) setCidBlobUrls(urls);
    }
    fetchCidBlobs();
    return () => { cancelled = true; objectUrls.forEach(url => URL.revokeObjectURL(url)); };
  }, [client, email?.id, email?.attachments]);

  const emailContent = useMemo(() => {
    if (!email) return { html: "", isHtml: false };
    if (email.bodyValues) {
      let useHtmlVersion = false;
      let htmlContent = '';
      if (email.htmlBody?.[0]?.partId && email.bodyValues[email.htmlBody[0].partId]) {
        htmlContent = email.bodyValues[email.htmlBody[0].partId].value;
        const textPartId = email.textBody?.[0]?.partId;
        const htmlPartId = email.htmlBody[0].partId;
        const hasDistinctTextBody = !!textPartId && textPartId !== htmlPartId && !!email.bodyValues[textPartId];
        if (hasDistinctTextBody && htmlContent) {
          useHtmlVersion = hasMeaningfulHtmlBody(htmlContent);
        } else {
          useHtmlVersion = !!htmlContent;
        }
      }
      if (useHtmlVersion && htmlContent) {
        if (email.attachments) {
          htmlContent = htmlContent.replace(/\bcid:([^"'\s)]+)/gi, (_match, cidRef) =>
            cidBlobUrls[cidRef] || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
          );
        }
        let blockedExternalContent = false;
        const sanitizeConfig = { ...EMAIL_SANITIZE_CONFIG };
        DOMPurify.addHook('afterSanitizeAttributes', (node) => {
          const htmlNode = node as HTMLElement;
          if (!allowExternal) {
            if (node.tagName === 'IMG') {
              const src = node.getAttribute('src');
              if (src && (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//'))) {
                node.setAttribute('data-blocked-src', src);
                node.removeAttribute('src');
                node.setAttribute('alt', '[Image blocked]');
                blockedExternalContent = true;
              }
            }
            if (node.hasAttribute('style')) {
              const style = node.getAttribute('style');
              if (style && /url\s*\(/i.test(style)) {
                node.setAttribute('style', style.replace(/url\s*\([^)]*\)/gi, 'none'));
                blockedExternalContent = true;
              }
            }
          }
          if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
          if (resolvedTheme === 'dark' && !emailAlwaysLightMode) {
            if (htmlNode.style) {
              const orig = htmlNode.style.cssText;
              const tx = transformInlineStyles(orig, 'dark');
              if (tx !== orig) htmlNode.style.cssText = tx;
            }
            const colorAttr = node.getAttribute('color');
            if (colorAttr) node.setAttribute('color', transformColorForDarkMode(colorAttr));
            const bgcolorAttr = node.getAttribute('bgcolor');
            if (bgcolorAttr) node.setAttribute('bgcolor', transformBgColorForDarkMode(bgcolorAttr));
          }
        });
        const sanitized = DOMPurify.sanitize(htmlContent, sanitizeConfig);
        DOMPurify.removeHook('afterSanitizeAttributes');
        let finalHtml = sanitized;
        if (blockedExternalContent) { setHasBlockedContent(true); finalHtml = collapseBlockedImageContainers(sanitized); }
        return { html: finalHtml, isHtml: true };
      }
      if (email.textBody?.[0]?.partId && email.bodyValues[email.textBody[0].partId]) {
        return { html: plainTextToSafeHtml(email.bodyValues[email.textBody[0].partId].value, 'text-primary hover:underline'), isHtml: false };
      }
    }
    if (email.preview) {
      return { html: email.preview.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), isHtml: false };
    }
    return { html: "", isHtml: false };
  }, [email, allowExternal, resolvedTheme, emailAlwaysLightMode, cidBlobUrls]);

  return (
    <div className={cn(
      "border-b border-border/50 last:border-b-0",
      isExpanded && isLast && "mb-0"
    )}>
      {/* Collapsed header — clicking expands */}
      {!isExpanded ? (
        <div
          onClick={onToggleExpanded}
          className={cn(
            "w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors text-left cursor-pointer select-none",
            isUnread ? "bg-muted/15" : "bg-background"
          )}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggleExpanded();
            }
          }}
        >
          {density !== 'extra-compact' && (
            <Avatar name={sender?.name} email={sender?.email} size="sm" className="w-8 h-8 rounded-full flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0 flex items-center gap-3">
            <span className={cn("text-sm truncate flex-shrink-0", isUnread ? "font-semibold text-foreground" : "font-medium text-foreground/90")}>
              {sender?.name || sender?.email || "Unknown"}
            </span>
            {snippet && (
              <span className="text-sm text-muted-foreground truncate flex-1 min-w-0">
                {snippet}
              </span>
            )}
            {email.hasAttachment && <Paperclip className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
          </div>
          <div className="flex items-center gap-2.5 flex-shrink-0 ml-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">{formatThreadDate(email.receivedAt)}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleToggleStar();
              }}
              className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground"
              title={isStarred ? "Starred" : "Star"}
            >
              <Star className={cn("w-4 h-4 transition-colors", isStarred ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40 hover:text-muted-foreground")} />
            </button>
          </div>
        </div>
      ) : (
        /* Expanded card */
        <div className={cn(
          "transition-all duration-200 bg-background",
          isUnread && "border-l-2 border-l-primary"
        )}>
          {/* Expanded header — clicking non-action areas toggles collapse */}
          <div
            onClick={onToggleExpanded}
            className="flex items-start gap-3 px-4 pt-4 pb-2.5 cursor-pointer select-none"
          >
            {density !== 'extra-compact' && (
              <Avatar name={sender?.name} email={sender?.email} size="md" className="w-9 h-9 rounded-full flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-foreground text-sm truncate">
                  {sender?.name || sender?.email || "Unknown"}
                </span>
              </div>
              <div className="relative inline-block mt-0.5" ref={detailsRef}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDetails(v => !v);
                  }}
                  className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded px-1 -ml-1 py-0.5 hover:bg-muted/60"
                >
                  <span>to {toLabel}</span>
                  <ChevronDown className={cn("w-3 h-3 transition-transform", showDetails && "rotate-180")} />
                </button>

                {showDetails && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-0 top-full mt-1.5 p-3 rounded-lg bg-popover border border-border shadow-lg text-xs z-30 min-w-[280px] max-w-[400px] space-y-1.5 text-foreground cursor-default"
                  >
                    <div className="grid grid-cols-[54px_1fr] gap-1">
                      <span className="text-muted-foreground">From:</span>
                      <span className="font-medium truncate">{sender?.name ? `${sender.name} <${sender.email}>` : sender?.email}</span>
                    </div>
                    <div className="grid grid-cols-[54px_1fr] gap-1">
                      <span className="text-muted-foreground">To:</span>
                      <span className="truncate">{email.to?.map(r => r.name ? `${r.name} <${r.email}>` : r.email).join(', ') || 'me'}</span>
                    </div>
                    {email.cc && email.cc.length > 0 && (
                      <div className="grid grid-cols-[54px_1fr] gap-1">
                        <span className="text-muted-foreground">Cc:</span>
                        <span className="truncate">{email.cc.map(r => r.name ? `${r.name} <${r.email}>` : r.email).join(', ')}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-[54px_1fr] gap-1">
                      <span className="text-muted-foreground">Date:</span>
                      <span>{email.receivedAt ? new Date(email.receivedAt).toLocaleString() : ''}</span>
                    </div>
                    <div className="grid grid-cols-[54px_1fr] gap-1">
                      <span className="text-muted-foreground">Subject:</span>
                      <span className="truncate">{email.subject || '(no subject)'}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 flex-shrink-0 cursor-default"
            >
              <span className="text-xs text-muted-foreground whitespace-nowrap mr-1">{formatThreadDate(email.receivedAt)}</span>
              <button
                type="button"
                onClick={handleToggleStar}
                className="p-1.5 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                title={isStarred ? "Starred" : "Star"}
              >
                <Star className={cn("w-4 h-4 transition-colors", isStarred ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40 hover:text-muted-foreground")} />
              </button>
              {onReply && (
                <button
                  type="button"
                  onClick={onReply}
                  className="p-1.5 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                  title={t("email_viewer.reply")}
                >
                  <Reply className="w-4 h-4" />
                </button>
              )}
              {(onReplyAll || onForward) && (
                <div className="relative" ref={moreMenuRef}>
                  <button
                    type="button"
                    onClick={() => setShowMoreMenu(v => !v)}
                    className="p-1.5 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    title="More actions"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                  {showMoreMenu && (
                    <div className="absolute right-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-md py-1 min-w-[140px] z-20">
                      {onReplyAll && (
                        <button type="button" onClick={() => { setShowMoreMenu(false); onReplyAll(); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted transition-colors text-left">
                          <ReplyAll className="w-4 h-4" /> {t("email_viewer.reply_all")}
                        </button>
                      )}
                      {onForward && (
                        <button type="button" onClick={() => { setShowMoreMenu(false); onForward(); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted transition-colors text-left">
                          <Forward className="w-4 h-4" /> {t("email_viewer.forward")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* External content warning */}
          {hasBlockedContent && !allowExternal && (
            <div className="mx-4 px-3 py-2 mb-2 bg-muted/50 rounded-lg flex items-center justify-between text-sm">
              <span className="text-muted-foreground text-xs">{t("email_viewer.external_content_warning")}</span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onAllowExternal(); }}>
                  {t("email_viewer.load_external_content")}
                </Button>
                {onTrustSender && (
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onTrustSender(); }}>
                    {t("email_viewer.trust_sender")}
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Email body */}
          <div className="px-4 pb-4 pl-[52px]">
            <div
              className={cn(
                "prose prose-sm max-w-none",
                !emailAlwaysLightMode && "dark:prose-invert",
                "prose-p:my-2 prose-headings:my-3",
                "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
                "[&_table]:border-collapse [&_td]:p-2 [&_th]:p-2",
                "[&_img]:max-w-full [&_img]:h-auto"
              )}
              style={!emailContent.isHtml ? { whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace', fontSize: '13px' } : undefined}
              dangerouslySetInnerHTML={{ __html: emailContent.html }}
            />
          </div>

          {/* Attachments */}
          {(() => {
            const visibleAttachments = (email.attachments ?? []).filter(
              att => !(hideInlineImageAttachments && att.cid && att.disposition === 'inline' && (att.type || '').startsWith('image/'))
            );
            return visibleAttachments.length > 0 && (
              <div className="px-4 pb-4 pl-[52px]">
                <div className="flex flex-wrap gap-2">
                  {visibleAttachments.map((attachment, idx) => {
                    const Icon = getFileIcon(attachment.name, attachment.type);
                    const isPreviewable = isFilePreviewable(attachment.name, attachment.type);
                    const opensPreview = isPreviewable && mailAttachmentAction === 'preview';
                    return (
                      <button
                        key={idx}
                        onClick={(e) => { e.stopPropagation(); onDownloadAttachment?.(attachment.blobId, attachment.name || 'attachment', attachment.type); }}
                        title={opensPreview ? t('files.preview') : t('email_viewer.download')}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors text-sm"
                      >
                        <Icon className="w-4 h-4 text-muted-foreground" />
                        <span className="truncate max-w-[150px]">{attachment.name || 'Attachment'}</span>
                        <span className="text-muted-foreground text-xs">{formatFileSize(attachment.size)}</span>
                        {opensPreview ? <Eye className="w-4 h-4 text-muted-foreground" /> : <Download className="w-4 h-4 text-muted-foreground" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
