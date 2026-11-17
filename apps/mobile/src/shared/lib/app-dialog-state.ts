import type { AlertButton, AlertOptions } from "react-native";

export type AppDialogRequest = {
  key: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
  options?: AlertOptions;
};

/** One queue for confirmations and failures. A second alert never replaces a pending decision. */
export class AppDialogController {
  private nextKey = 1;
  private hosts = 0;
  private queue: AppDialogRequest[] = [];
  private listeners = new Set<() => void>();
  private frosted = false;

  getSnapshot = (): AppDialogRequest | null => this.queue[0] ?? null;
  getFrosted = (): boolean => this.frosted;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  mount(): () => void {
    this.hosts += 1;
    return () => {
      this.hosts -= 1;
      if (this.hosts === 0) {
        // Do not retain callbacks or execute a destructive action after the app root is gone.
        this.queue = [];
        this.frosted = false;
        this.notify();
      }
    };
  }

  show(request: Omit<AppDialogRequest, "key">): boolean {
    if (this.hosts === 0) return false;
    this.queue = [...this.queue, { ...request, key: this.nextKey++ }];
    this.notify();
    return true;
  }

  setFrosted(key: number, frosted: boolean): void {
    if (this.getSnapshot()?.key !== key || this.frosted === frosted) return;
    this.frosted = frosted;
    this.notify();
  }

  /** Called after the host closes. Stale animation callbacks and repeated taps cannot act twice. */
  settle(key: number, button: number | null): boolean {
    const request = this.getSnapshot();
    if (!request || request.key !== key) return false;
    if (button === null && request.options?.cancelable !== true) return false;
    if (button !== null && !request.buttons[button]) return false;
    this.queue = this.queue.slice(1);
    this.frosted = false;
    this.notify();
    if (button === null) request.options?.onDismiss?.();
    else request.buttons[button]?.onPress?.();
    return true;
  }
}

export const appDialogs = new AppDialogController();
