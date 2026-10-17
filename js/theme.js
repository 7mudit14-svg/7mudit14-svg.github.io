/**
 * Theme Engine for Mudit Todi's Robotics Portfolio
 * Supports Auto-detection of device theme (prefers-color-scheme: dark/light)
 * Provides 3-way toggle: Light, Dark, Auto (System)
 * Broadcasts 'themechange' event for Three.js and dynamic UI elements
 */

(function () {
    const THEME_STORAGE_KEY = 'robotics_portfolio_theme_mode';
    const VALID_MODES = ['light', 'dark', 'auto'];

    // Get initial saved mode or default to 'auto' (storage can throw in private mode)
    let currentMode = 'auto';
    try {
        currentMode = localStorage.getItem(THEME_STORAGE_KEY) || 'auto';
    } catch (e) { /* ignore */ }
    if (!VALID_MODES.includes(currentMode)) {
        currentMode = 'auto';
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    // Paint the resolved theme immediately (this script loads in <head>)
    document.documentElement.setAttribute('data-theme-mode', currentMode);
    document.documentElement.setAttribute('data-theme', currentMode === 'auto' ? (mediaQuery.matches ? 'dark' : 'light') : currentMode);

    function resolveActiveTheme(mode) {
        if (mode === 'auto') {
            return mediaQuery.matches ? 'dark' : 'light';
        }
        return mode;
    }

    function applyTheme(mode, notify = true) {
        currentMode = mode;
        try {
            localStorage.setItem(THEME_STORAGE_KEY, mode);
        } catch (e) { /* ignore */ }
        const activeTheme = resolveActiveTheme(mode);

        document.documentElement.setAttribute('data-theme-mode', mode);
        document.documentElement.setAttribute('data-theme', activeTheme);
        document.documentElement.classList.remove('theme-light', 'theme-dark');
        document.documentElement.classList.add(`theme-${activeTheme}`);

        // Update meta theme-color for browser address bar
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) {
            metaTheme.setAttribute('content', activeTheme === 'dark' ? '#0a0c10' : '#f8fafd');
        }

        // Update toggle UI active buttons
        updateToggleUI(mode, activeTheme);

        if (notify) {
            window.dispatchEvent(new CustomEvent('themechange', {
                detail: {
                    mode: mode,
                    activeTheme: activeTheme,
                    isDark: activeTheme === 'dark'
                }
            }));
        }
    }

    function updateToggleUI(mode, activeTheme) {
        const toggleContainer = document.getElementById('theme-toggle-group');
        if (!toggleContainer) return;

        const buttons = toggleContainer.querySelectorAll('.theme-btn');
        buttons.forEach(btn => {
            const btnMode = btn.getAttribute('data-mode');
            if (btnMode === mode) {
                btn.classList.add('active');
                btn.setAttribute('aria-pressed', 'true');
            } else {
                btn.classList.remove('active');
                btn.setAttribute('aria-pressed', 'false');
            }
        });

        // Update indicator slider position if present
        const indicator = toggleContainer.querySelector('.theme-slider-indicator');
        if (indicator) {
            const activeBtn = toggleContainer.querySelector(`.theme-btn[data-mode="${mode}"]`);
            if (activeBtn) {
                indicator.style.width = `${activeBtn.offsetWidth}px`;
                indicator.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
            }
        }
    }

    // React to system preference changes when in 'auto' mode
    mediaQuery.addEventListener('change', (e) => {
        if (currentMode === 'auto') {
            applyTheme('auto', true);
        }
    });

    // Expose global API
    window.PortfolioTheme = {
        getMode: () => currentMode,
        getActiveTheme: () => resolveActiveTheme(currentMode),
        isDark: () => resolveActiveTheme(currentMode) === 'dark',
        setMode: (mode) => {
            if (VALID_MODES.includes(mode)) {
                applyTheme(mode, true);
            }
        }
    };

    // Initialize as soon as DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            applyTheme(currentMode, false);
            setupListeners();
        });
    } else {
        applyTheme(currentMode, false);
        setupListeners();
    }

    function setupListeners() {
        const toggleContainer = document.getElementById('theme-toggle-group');
        if (!toggleContainer) return;

        toggleContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.theme-btn');
            if (!btn) return;
            const targetMode = btn.getAttribute('data-mode');
            if (targetMode && VALID_MODES.includes(targetMode)) {
                PortfolioTheme.setMode(targetMode);
            }
        });

        // Initial UI update after render
        setTimeout(() => {
            updateToggleUI(currentMode, resolveActiveTheme(currentMode));
        }, 50);
    }
})();
