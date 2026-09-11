"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import { Email, ThreadGroup } from "@/lib/jmap/types";
import { EMAIL_SANITIZE_CONFIG, collapseBlockedImageContainers, plainTextToSafeHtml } from "@/lib/email-sanitization";
import { hasMeaningfulHtmlBody } from "@/lib/signature-utils";
import { transformInlineStyles, transformColorForDarkMode, transformBgColorForDarkMode } from "@/lib/color-transform";
import { useThemeStore } from "@/stores/theme-store";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { formatDateDetailed, formatFileSize, cn } from "@/lib/utils";
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

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [allowExternalContent, setAllowExternalContent] = useState<Set<string>>(new Set());
  const [showAllEmails, setShowAllEmails] = useState(false);

  // emails arrive oldest-first from getThreadEmails — no need to reverse
  // Auto-expand the newest email (last in array) + any unread emails
  useEffect(() => {
    if (emails.length > 0) {
      const idsToExpand = new Set<string>();
      idsToExpand.add(emails[emails.length - 1].id);
      emails.forEach(email => {
        if (!email.keywords?.$seen) idsToExpand.add(email.id);
      });
      setExpandedIds(idsToExpand);
      setShowAllEmails(false);
    }
  }, [emails]);

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
  const latestEmail = emails[emails.length - 1];

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
      {/* This is the actual top-of-screen header on mobile (it replaces
          MobileHeader while an email is open), but it's `sticky` inside this
          pane's own scrollable message list — not a direct child of body —
          so body's safe-area padding doesn't reach it the way it does
          MobileHeader. Add the inset directly rather than depend on that
          cascade holding across whatever scroll container ends up between
          them. paddingBlock (shorthand) is split into top/bottom so the
          inset only affects the top, not the existing bottom spacing. */}
      <div className="flex items-center gap-3 px-4 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 sticky top-0 z-10" style={{ paddingTop: 'calc(var(--density-header-py) + env(safe-area-inset-top, 0px))', paddingBottom: 'var(--density-header-py)' }}>
        <button onClick={onBack} className="p-2 -ml-2 rounded-full hover:bg-muted transition-colors flex-shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="flex-1 min-w-0 font-semibold text-foreground truncate text-base">
          {thread.latestEmail.subject || t("email_viewer.no_subject")}
        </h1>
        {onRestoreToInbox && (
          <Button variant="outline" size="sm" onClick={onRestoreToInbox} className="flex-shrink-0 gap-1.5">
            <Undo2 className="w-4 h-4" />
            Restore
          </Button>
        )}
      </div>

      {/* Thread emails */}
      {/* Same reasoning as the header's top inset above, but for the bottom:
          this pane sits inside the `fixed inset-0` mobile viewer/composer
          shell (app/[locale]/page.tsx), so body's safe-area-bottom padding
          never reaches it either. Without this, the last line of a message
          — or the Reply/Forward pills below it — renders underneath
          Android's on-screen navigation bar. */}
      <div className="flex-1 overflow-y-auto min-h-0 pb-[env(safe-area-inset-bottom,0px)]">
        <div className="py-2">
          {(() => {
            const collapseMiddle = !showAllEmails && emails.length > 3;
            const hiddenCount = collapseMiddle ? emails.length - 2 : 0;
            const visibleEmails = collapseMiddle
              ? [emails[0], emails[emails.length - 1]]
              : emails;

            return visibleEmails.map((email, visibleIndex) => {
              const originalIndex = collapseMiddle && visibleIndex === 1 ? emails.length - 1 : visibleIndex;
              const senderEmail = email.from?.[0]?.email?.toLowerCase();
              const senderIsTrusted = senderEmail
                ? isSenderTrusted(senderEmail) || (trustedSendersAddressBook && isTrustedAddressBookSender(senderEmail))
                : false;
              const isLast = originalIndex === emails.length - 1;
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

        {/* Gmail-style pill Reply / Forward at bottom */}
        {latestEmail && (onReply || onForward) && (
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

interface EmailCardProps {
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

function EmailCard({
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
  const isStarred = email.keywords?.$flagged;
  const [hasBlockedContent, setHasBlockedContent] = useState(false);
  const [cidBlobUrls, setCidBlobUrls] = useState<Record<string, string>>({});
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const { client } = useAuthStore();

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
        <button
          onClick={onToggleExpanded}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
        >
          {density !== 'extra-compact' && (
            <Avatar name={sender?.name} email={sender?.email} size="sm" className="flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className={cn("text-sm truncate", isUnread ? "font-semibold text-foreground" : "font-medium text-foreground/80")}>
                {sender?.name || sender?.email || "Unknown"}
              </span>
              {email.hasAttachment && <Paperclip className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {email.preview || ""}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDateDetailed(email.receivedAt)}</span>
            {isStarred && <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />}
          </div>
        </button>
      ) : (
        /* Expanded card */
        <div className={cn(
          "transition-all duration-200",
          isUnread && "border-l-2 border-l-primary"
        )}>
          {/* Expanded header */}
          <div className="flex items-start gap-3 px-4 pt-4 pb-2">
            {density !== 'extra-compact' && (
              <Avatar name={sender?.name} email={sender?.email} size="md" className="flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-semibold text-foreground text-sm">
                  {sender?.name || sender?.email || "Unknown"}
                </span>
                {sender?.name && sender?.email && (
                  <span className="text-xs text-muted-foreground">&lt;{sender.email}&gt;</span>
                )}
                {isStarred && <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />}
              </div>
              {toRecipients && (
                <button
                  onClick={onToggleExpanded}
                  // Browsers default <button> to `text-align: center` in their
                  // UA stylesheet; it's inherited by the <span> below and, once
                  // the recipient list is long enough to wrap, centers every
                  // wrapped line instead of the intended flush-left address
                  // list. `text-left` overrides it — same fix the collapsed
                  // thread-item button above already carries.
                  className="flex items-start gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors mt-0.5 text-left"
                >
                  <span>to {toRecipients}</span>
                  <ChevronDown className="w-3 h-3 mt-0.5 flex-shrink-0" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <span className="text-xs text-muted-foreground whitespace-nowrap mr-1">{formatDateDetailed(email.receivedAt)}</span>
              {onReply && (
                <button
                  onClick={(e) => { e.stopPropagation(); onReply(); }}
                  className="p-1.5 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                  title={t("email_viewer.reply")}
                >
                  <Reply className="w-4 h-4" />
                </button>
              )}
              {(onReplyAll || onForward) && (
                <div className="relative" ref={moreMenuRef}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowMoreMenu(v => !v); }}
                    className="p-1.5 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    title="More actions"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                  {showMoreMenu && (
                    <div className="absolute right-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-md py-1 min-w-[140px] z-20">
                      {onReplyAll && (
                        <button onClick={(e) => { e.stopPropagation(); setShowMoreMenu(false); onReplyAll(); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted transition-colors">
                          <ReplyAll className="w-4 h-4" /> {t("email_viewer.reply_all")}
                        </button>
                      )}
                      {onForward && (
                        <button onClick={(e) => { e.stopPropagation(); setShowMoreMenu(false); onForward(); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted transition-colors">
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
