// ============ HTML ESCAPING ============
export function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

// ============ MESSAGE MARKUP PARSER ============
export function parseMessageMarkup(text) {
    let s = escapeHtml(text);

    // Preserve newlines
    s = s.replace(/\n/g, '<br>');

    // "quoted text" -> white highlight
    s = s.replace(/"([^"]+)"/g, '<span class="msg-quoted">"$1"</span>');

    // **bold**
    s = s.replace(/\*\*(.+?)\*\*/g, '<span class="msg-bold">$1</span>');

    // *italic*  (not inside a bold span)
    s = s.replace(/\*([^*\n]+)\*/g, '<span class="msg-italic">$1</span>');

    return s;
}

// ============ TOAST NOTIFICATIONS ============
export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const el = document.createElement('div');
    el.className   = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);

    // Trigger CSS transition
    requestAnimationFrame(() => el.classList.add('visible'));

    setTimeout(() => {
        el.classList.remove('visible');
        setTimeout(() => el.remove(), 350);
    }, 3500);
}

// ============ TIMESTAMP FORMATTER ============
export function formatTimestamp(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 60_000)       return 'just now';
    if (diff < 3_600_000)    return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000)   return `${Math.floor(diff / 3_600_000)}h ago`;
    if (diff < 604_800_000)  return `${Math.floor(diff / 86_400_000)}d ago`;
    return new Date(ts).toLocaleDateString();
}
