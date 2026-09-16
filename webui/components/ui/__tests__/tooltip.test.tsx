import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Tooltip } from '../tooltip';

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders trigger element', () => {
    render(
      <Tooltip content="Tooltip message">
        <button>Hover me</button>
      </Tooltip>
    );
    expect(screen.getByText('Hover me')).toBeInTheDocument();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows tooltip on hover after delay', () => {
    render(
      <Tooltip content="Tooltip message" delay={100}>
        <button>Hover me</button>
      </Tooltip>
    );

    const button = screen.getByText('Hover me');
    fireEvent.mouseEnter(button);

    // Not visible immediately before delay
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    // Advance timers by delay
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByText('Tooltip message')).toBeInTheDocument();

    // Hides on mouse leave
    fireEvent.mouseLeave(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('does not show tooltip when disabled', () => {
    render(
      <Tooltip content="Tooltip message" disabled delay={50}>
        <button>Hover me</button>
      </Tooltip>
    );

    const button = screen.getByText('Hover me');
    fireEvent.mouseEnter(button);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('hides tooltip on pointer down (click)', () => {
    render(
      <Tooltip content="Action tooltip" delay={50}>
        <button>Clickable</button>
      </Tooltip>
    );

    const button = screen.getByText('Clickable');
    fireEvent.mouseEnter(button);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.pointerDown(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('renders complex content with badge', () => {
    render(
      <Tooltip
        content={
          <div data-testid="custom-content">
            <span>Inbox</span>
            <span data-testid="badge">5</span>
          </div>
        }
        delay={50}
      >
        <button>Mailbox</button>
      </Tooltip>
    );

    const button = screen.getByText('Mailbox');
    fireEvent.mouseEnter(button);
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(screen.getByTestId('custom-content')).toBeInTheDocument();
    expect(screen.getByTestId('badge')).toHaveTextContent('5');
  });
});
