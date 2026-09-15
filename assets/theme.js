(() => {
  const key = 'webdir-theme';
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  const root = document.documentElement;
  const updateButton = theme => {
    const button = document.querySelector('#theme-toggle');
    if (!button) return;
    const label = theme === 'dark' ? '切换到浅色模式' : '切换到深色模式';
    button.setAttribute('aria-label', label);
    button.title = label;
  };
  const applyTheme = theme => {
    root.dataset.theme = theme;
    updateButton(theme);
    window.renderMarkdownMermaid?.(true);
    document.querySelector('#preview')?.contentWindow?.applyWebdirTheme?.(theme);
  };
  window.applyWebdirTheme = applyTheme;
  applyTheme(localStorage.getItem(key) || (systemTheme.matches ? 'dark' : 'light'));
  systemTheme.addEventListener('change', () => {
    if (!localStorage.getItem(key)) applyTheme(systemTheme.matches ? 'dark' : 'light');
  });
  window.addEventListener('storage', event => {
    if (event.key === key) applyTheme(event.newValue || (systemTheme.matches ? 'dark' : 'light'));
  });
  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.classList.contains('preview-body')) return;
    const button = document.createElement('button');
    button.id = 'theme-toggle';
    button.type = 'button';
    button.innerHTML = `<svg class="theme-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="theme-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.1A8.6 8.6 0 0 1 9.9 3.5a8.6 8.6 0 1 0 10.6 10.6Z"/></svg>`;
    (document.querySelector('.path-search') || document.body).append(button);
    updateButton(root.dataset.theme);
    document.querySelector('#theme-toggle')?.addEventListener('click', () => {
      const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem(key, theme);
      applyTheme(theme);
    });
  });
})();
