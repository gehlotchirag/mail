"use client";

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  cloneElement,
  isValidElement,
  type ReactNode,
  type ReactElement,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  disabled?: boolean;
  delay?: number;
  className?: string;
}

export function Tooltip({
  content,
  children,
  side = "right",
  disabled = false,
  delay = 100,
  className,
}: TooltipProps) {
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; transform: string } | null>(null);

  const triggerRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsOpen(false);
  }, []);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const GAP = 8;
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    let top = 0;
    let left = 0;
    let transform = "";

    switch (side) {
      case "right": {
        left = rect.right + GAP;
        top = rect.top + rect.height / 2;
        // Clamp top if near edges
        if (top < 20) {
          top = 10;
          transform = "none";
        } else if (top > vh - 20) {
          top = vh - 10;
          transform = "translateY(-100%)";
        } else {
          transform = "translateY(-50%)";
        }
        break;
      }
      case "left": {
        left = rect.left - GAP;
        top = rect.top + rect.height / 2;
        if (top < 20) {
          top = 10;
          transform = "translateX(-100%)";
        } else if (top > vh - 20) {
          top = vh - 10;
          transform = "translate(-100%, -100%)";
        } else {
          transform = "translate(-100%, -50%)";
        }
        break;
      }
      case "top": {
        left = rect.left + rect.width / 2;
        top = rect.top - GAP;
        transform = "translate(-50%, -100%)";
        break;
      }
      case "bottom": {
        left = rect.left + rect.width / 2;
        top = rect.bottom + GAP;
        transform = "translate(-50%, 0)";
        break;
      }
    }

    setCoords({ top, left, transform });
  }, [side]);

  const show = useCallback(() => {
    if (disabled || !content) return;
    updatePosition();
    setIsOpen(true);
  }, [disabled, content, updatePosition]);

  const startShowTimer = useCallback(() => {
    if (disabled || !content) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      show();
    }, delay);
  }, [disabled, content, delay, show]);

  useEffect(() => {
    if (disabled) {
      hide();
    }
  }, [disabled, hide]);

  // Hide on escape or scroll/resize
  useEffect(() => {
    if (!isOpen) return;

    const handleScrollOrResize = () => {
      hide();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };

    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, hide]);

  const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    const childProps = isValidElement(children) ? (children.props as Record<string, unknown>) : null;
    if (typeof childProps?.onMouseEnter === "function") {
      (childProps.onMouseEnter as (ev: React.MouseEvent<HTMLElement>) => void)(e);
    }
    startShowTimer();
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    const childProps = isValidElement(children) ? (children.props as Record<string, unknown>) : null;
    if (typeof childProps?.onMouseLeave === "function") {
      (childProps.onMouseLeave as (ev: React.MouseEvent<HTMLElement>) => void)(e);
    }
    hide();
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    const childProps = isValidElement(children) ? (children.props as Record<string, unknown>) : null;
    if (typeof childProps?.onPointerDown === "function") {
      (childProps.onPointerDown as (ev: React.PointerEvent<HTMLElement>) => void)(e);
    }
    hide();
  };

  const handleFocus = (e: React.FocusEvent<HTMLElement>) => {
    const childProps = isValidElement(children) ? (children.props as Record<string, unknown>) : null;
    if (typeof childProps?.onFocus === "function") {
      (childProps.onFocus as (ev: React.FocusEvent<HTMLElement>) => void)(e);
    }
    show();
  };

  const handleBlur = (e: React.FocusEvent<HTMLElement>) => {
    const childProps = isValidElement(children) ? (children.props as Record<string, unknown>) : null;
    if (typeof childProps?.onBlur === "function") {
      (childProps.onBlur as (ev: React.FocusEvent<HTMLElement>) => void)(e);
    }
    hide();
  };

  let triggerElement: ReactElement;

  if (isValidElement(children)) {
    const child = children as ReactElement<Record<string, unknown>>;
    const originalRef = (child as unknown as { ref?: React.Ref<HTMLElement> }).ref || (child.props as { ref?: React.Ref<HTMLElement> })?.ref;

    triggerElement = cloneElement(child, {
      ref: (node: HTMLElement | null) => {
        triggerRef.current = node;
        if (typeof originalRef === "function") {
          originalRef(node);
        } else if (originalRef && typeof originalRef === "object" && "current" in originalRef) {
          (originalRef as React.MutableRefObject<HTMLElement | null>).current = node;
        }
      },
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
      onPointerDown: handlePointerDown,
      onFocus: handleFocus,
      onBlur: handleBlur,
    });
  } else {
    triggerElement = (
      <span
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onPointerDown={handlePointerDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className="inline-flex"
      >
        {children}
      </span>
    );
  }

  const tooltipStyle: CSSProperties = {
    position: "fixed",
    top: coords ? `${coords.top}px` : undefined,
    left: coords ? `${coords.left}px` : undefined,
    transform: coords?.transform,
  };

  return (
    <>
      {triggerElement}
      {mounted && isOpen && coords && createPortal(
        <div
          role="tooltip"
          style={tooltipStyle}
          className={cn(
            "fixed z-[9999] pointer-events-none select-none",
            "px-2.5 py-1 text-xs font-medium",
            "bg-popover text-popover-foreground border border-border shadow-md rounded-md",
            "animate-in fade-in-0 zoom-in-95 duration-100 ease-out",
            "whitespace-nowrap flex items-center gap-1.5",
            className
          )}
        >
          {content}
        </div>,
        document.body
      )}
    </>
  );
}
