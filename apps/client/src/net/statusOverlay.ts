// Small text overlay for lobby and connection state (ws mode). Plain DOM, outside the HUD.

export interface StatusOverlay {
  set(text: string | null): void;
}

export function createStatusOverlay(parent: HTMLElement = document.body): StatusOverlay {
  const el = document.createElement('div');
  el.id = 'net-status';
  el.setAttribute('role', 'status');
  el.style.cssText =
    'position:fixed;left:50%;top:12px;transform:translateX(-50%);max-width:80vw;padding:6px 14px;border-radius:6px;' +
    'background:rgba(0,0,0,.75);color:#ddd;font:14px system-ui,sans-serif;z-index:20;pointer-events:none;display:none';
  parent.appendChild(el);
  return {
    set(text) {
      el.textContent = text ?? '';
      el.style.display = text ? 'block' : 'none';
    },
  };
}
