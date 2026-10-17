/**
 * Kinetic Animations, 3D Pop-Out Card Physics & Interactive Controls
 * Powered by Anime.js & Vanilla 3D Pointer Math
 */

(function () {
    document.addEventListener('DOMContentLoaded', () => {
        initHeroAnimations();
        initScrollObservers();
        init3DCardTilt();
        initMediaModal();
        initLoopSwitcher();
    });

    // ==========================================
    // 1. Hero & Header Kinetic Entrance (Anime.js)
    // ==========================================
    function initHeroAnimations() {
        if (typeof anime === 'undefined') return;

        anime.timeline({
            easing: 'easeOutExpo'
        })
            .add({
                targets: '.nav-brand, .nav-links li, .theme-toggle-container',
                translateY: [-20, 0],
                opacity: [0, 1],
                delay: anime.stagger(50),
                duration: 750
            })
            .add({
                targets: '.hero-badge-container .status-chip',
                scale: [0.85, 1],
                opacity: [0, 1],
                delay: anime.stagger(60),
                duration: 600
            }, '-=400')
            .add({
                targets: '.hero-title .title-line',
                translateY: [35, 0],
                opacity: [0, 1],
                duration: 850,
                delay: anime.stagger(100)
            }, '-=450')
            .add({
                targets: '.hero-pitch-lead',
                translateY: [20, 0],
                opacity: [0, 1],
                duration: 700
            }, '-=500')
            .add({
                targets: '.hero-cta-group .btn',
                translateY: [20, 0],
                opacity: [0, 1],
                delay: anime.stagger(80),
                duration: 600
            }, '-=400')
            .add({
                targets: '.hero-3d-wrapper',
                scale: [0.96, 1],
                opacity: [0, 1],
                duration: 900
            }, '-=650');
    }

    // ==========================================
    // 2. 3D Pop-Out Card Physics (Google Antigravity style)
    // ==========================================
    function init3DCardTilt() {
        // Effects need a mouse; on pure touch screens a tapped card would stay tilted
        if (!window.matchMedia('(any-hover: hover)').matches) return;

        // .tilt-card = 3D tilt + glow + sheen, .glow-card = glow + sheen only (no tilt)
        const tiltCards = document.querySelectorAll('.tilt-card, .glow-card');

        tiltCards.forEach(card => {
            const doTilt = card.classList.contains('tilt-card');
            // Append sheen overlay if not present
            if (!card.querySelector('.sheen-reflection')) {
                const sheen = document.createElement('div');
                sheen.className = 'sheen-reflection';
                card.appendChild(sheen);
            }

            let rafId = null;

            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                const centerX = rect.width / 2;
                const centerY = rect.height / 2;

                const rotateX = ((y - centerY) / centerY) * -6.5; // deg
                const rotateY = ((x - centerX) / centerX) * 6.5;  // deg

                const pctX = (x / rect.width) * 100;
                const pctY = (y / rect.height) * 100;

                card.style.setProperty('--mouse-x', `${pctX}%`);
                card.style.setProperty('--mouse-y', `${pctY}%`);

                if (!doTilt) return;
                if (rafId) cancelAnimationFrame(rafId);
                rafId = requestAnimationFrame(() => {
                    card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(14px) scale3d(1.015, 1.015, 1.015)`;
                });
            });

            card.addEventListener('mouseleave', () => {
                if (!doTilt) return;
                if (rafId) cancelAnimationFrame(rafId);
                card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateZ(0px) scale3d(1, 1, 1)';
            });
        });
    }

    // ==========================================
    // 3. Viewport Observers & Numerical Counters
    // ==========================================
    function initScrollObservers() {
        const counters = document.querySelectorAll('.stat-number[data-target]');
        const counterObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const targetEl = entry.target;
                    const finalVal = parseFloat(targetEl.getAttribute('data-target'));
                    const isNegative = targetEl.getAttribute('data-negative') === 'true';
                    const decimals = parseInt(targetEl.getAttribute('data-decimals') || '0');

                    if (typeof anime !== 'undefined') {
                        const obj = { val: 0 };
                        anime({
                            targets: obj,
                            val: finalVal,
                            round: decimals > 0 ? 10 : 1,
                            duration: 1800,
                            easing: 'easeOutExpo',
                            update: function () {
                                const formatted = obj.val.toFixed(decimals);
                                targetEl.textContent = (isNegative ? '-' : '') + formatted;
                            }
                        });
                    } else {
                        targetEl.textContent = (isNegative ? '-' : '') + finalVal.toFixed(decimals);
                    }
                    observer.unobserve(targetEl);
                }
            });
        }, { threshold: 0.35 });

        counters.forEach(c => counterObserver.observe(c));

        // Smooth fade-in on scroll
        const reveals = document.querySelectorAll('.reveal-on-scroll');
        const revealObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('revealed');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.12 });

        reveals.forEach(el => revealObserver.observe(el));
    }

    // ==========================================
    // 4. Media Lightbox Modal
    // ==========================================
    function initMediaModal() {
        const modal = document.getElementById('media-inspect-modal');
        if (!modal) return;

        const modalImg = modal.querySelector('.modal-image');
        const modalVideo = modal.querySelector('.modal-video');
        const modalTitle = modal.querySelector('.modal-title');
        const modalDesc = modal.querySelector('.modal-description');
        const closeBtn = modal.querySelector('.modal-close-btn');
        const backdrop = modal.querySelector('.modal-backdrop');

        function openModal(type, src, title, desc) {
            modalTitle.textContent = title || 'Telemetry / Asset Preview';
            modalDesc.textContent = desc || '';

            if (type === 'video') {
                modalImg.style.display = 'none';
                modalVideo.style.display = 'block';
                modalVideo.src = src;
                modalVideo.play();
            } else {
                modalVideo.style.display = 'none';
                modalVideo.pause();
                modalImg.style.display = 'block';
                modalImg.src = src;
            }

            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
            if (window.PortfolioScroll) window.PortfolioScroll.stop();
        }

        function closeModal() {
            modal.classList.remove('active');
            modalVideo.pause();
            modalVideo.removeAttribute('src');
            document.body.style.overflow = '';
            if (window.PortfolioScroll) window.PortfolioScroll.start();
        }

        document.querySelectorAll('[data-inspect-src]').forEach(trigger => {
            trigger.addEventListener('click', (e) => {
                e.preventDefault();
                const src = trigger.getAttribute('data-inspect-src');
                const type = trigger.getAttribute('data-inspect-type') || 'image';
                const title = trigger.getAttribute('data-inspect-title') || '';
                const desc = trigger.getAttribute('data-inspect-desc') || '';
                openModal(type, src, title, desc);
            });
        });

        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        if (backdrop) backdrop.addEventListener('click', closeModal);
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) {
                closeModal();
            }
        });
    }

    // ==========================================
    // 5. Training Loop Switcher (Loop 1 vs Loop 4)
    // ==========================================
    function initLoopSwitcher() {
        const buttons = document.querySelectorAll('.loop-switch-btn');
        const imgEl = document.getElementById('mrac-loop-preview-img');
        const badgeEl = document.getElementById('mrac-loop-badge');
        const descEl = document.getElementById('mrac-loop-desc');

        if (!buttons.length || !imgEl) return;

        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                buttons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const loopId = btn.getAttribute('data-loop');
                if (loopId === '1') {
                    imgEl.width = 1080; imgEl.height = 1620;
                    imgEl.src = 'assets/images/loop_1.gif';
                    imgEl.setAttribute('data-inspect-src', imgEl.src);
                    if (badgeEl) badgeEl.textContent = 'Loop 1 — Initial Adaptation Phase';
                    if (descEl) descEl.textContent = 'High transient overshoot on Joint 2 & Joint 3 before weights converge. Controller adapts online from cold.';
                } else {
                    imgEl.width = 1080; imgEl.height = 1350;
                    imgEl.src = 'assets/images/loop_4.gif';
                    imgEl.setAttribute('data-inspect-src', imgEl.src);
                    if (badgeEl) badgeEl.textContent = 'Loop 4 — Fully Converged Trajectory Tracking';
                    if (descEl) descEl.textContent = 'Online weights Ŵ and Kx have settled. Joint error reduced by >75%, tracking Cartesian trajectories with sub-millimeter precision.';
                }
            });
        });
    }
})();
