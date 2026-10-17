/**
 * Smooth Scroll (Lenis), Mobile Navigation & Viewport-Aware Video Playback
 * - Lenis smooths wheel/trackpad scrolling on desktop; touch devices keep native momentum scrolling
 * - Anchor links (#project-arm, ...) glide to their section and respect scroll-margin-top under the fixed navbar
 * - Exposes window.PortfolioScroll.stop()/start() so modals can lock the page
 */

(function () {
    let lenis = null;

    function initLenis() {
        if (typeof Lenis === 'undefined') return;

        lenis = new Lenis({
            autoRaf: true,
            lerp: 0.1,
            wheelMultiplier: 1,
            smoothWheel: true,
            syncTouch: false,   // keep native scrolling on phones/tablets: feels right and costs nothing
            anchors: true,      // smooth-scroll in-page links; honours CSS scroll-margin-top
            stopInertiaOnNavigate: true
        });

        // Lenis drives the scroll itself, so the CSS smooth-scroll would fight it
        document.documentElement.style.scrollBehavior = 'auto';
    }

    function initMobileMenu() {
        const toggle = document.getElementById('nav-menu-toggle');
        const links = document.getElementById('nav-links');
        if (!toggle || !links) return;

        function setOpen(open) {
            document.body.classList.toggle('nav-open', open);
            toggle.setAttribute('aria-expanded', String(open));
            toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        }

        toggle.addEventListener('click', () => {
            setOpen(!document.body.classList.contains('nav-open'));
        });

        links.addEventListener('click', (e) => {
            if (e.target.closest('a')) setOpen(false);
        });

        document.addEventListener('click', (e) => {
            if (!document.body.classList.contains('nav-open')) return;
            if (!e.target.closest('.navbar')) setOpen(false);
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') setOpen(false);
        });

        window.matchMedia('(min-width: 769px)').addEventListener('change', (e) => {
            if (e.matches) setOpen(false);
        });
    }

    // Play muted loop videos only while on screen (saves bandwidth, battery and CPU)
    function initViewportVideos() {
        const videos = document.querySelectorAll('video[data-autoplay-visible]');
        if (!videos.length) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const video = entry.target;
                if (entry.isIntersecting) {
                    if (video.preload === 'none') video.preload = 'auto';
                    const p = video.play();
                    if (p && p.catch) p.catch(() => { /* autoplay blocked: poster stays visible */ });
                } else {
                    video.pause();
                }
            });
        }, { rootMargin: '200px 0px', threshold: 0.01 });

        videos.forEach(v => observer.observe(v));
    }

    window.PortfolioScroll = {
        stop: () => { if (lenis) lenis.stop(); },
        start: () => { if (lenis) lenis.start(); },
        get lenis() { return lenis; }
    };

    function init() {
        initLenis();
        initMobileMenu();
        initViewportVideos();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
