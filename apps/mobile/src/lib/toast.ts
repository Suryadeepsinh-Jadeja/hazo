export type ToastType = 'success' | 'error' | 'info' | 'default';

export interface ToastConfig {
  message: string;
  type: ToastType;
}

class ToastManager {
  private listener: ((config: ToastConfig | null) => void) | null = null;
  private timer: NodeJS.Timeout | null = null;

  setListener(listener: (config: ToastConfig | null) => void) {
    this.listener = listener;
  }

  show(message: string, type: ToastType = 'default') {
    if (this.listener) {
      this.listener({ message, type });
      
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        if (this.listener) this.listener(null);
      }, 3000);
    }
  }

  hide() {
    if (this.listener) this.listener(null);
    if (this.timer) clearTimeout(this.timer);
  }
}

export const toast = new ToastManager();
