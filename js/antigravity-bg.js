/**
 * Anti-Gravity Particle Background Engine (Inspired by https://antigravity.google/)
 * - Full-screen organic zero-gravity particle field
 * - Cursor repulsion, magnetic wake, and velocity-based perturbation
 * - Scroll inertia and anti-gravity drift
 * - Seamless theme integration (Dark: glowing cyan/blue/amber; Light: crisp slate/blue)
 */

(function () {
    let canvas, ctx;
    let particles = [];
    let width = 0, height = 0;
    let mouse = { x: -1000, y: -1000, radius: 140, isMoving: false, lastX: 0, lastY: 0, vx: 0, vy: 0 };
    let scrollY = 0, scrollSpeed = 0, lastScrollY = 0;
    let currentTheme = 'dark';
    let mouseTimeout;

    const PARTICLE_COUNT = 180;
    const CONNECT_DISTANCE = 110;

    class Particle {
        constructor() {
            this.reset(true);
        }

        reset(initial = false) {
            this.x = Math.random() * width;
            this.y = initial ? Math.random() * height : height + 10;
            this.baseSize = Math.random() * 2.2 + 1.0;
            this.size = this.baseSize;

            // Subtle base upward anti-gravity velocity
            this.vx = (Math.random() - 0.5) * 0.4;
            this.vy = -(Math.random() * 0.45 + 0.15);

            // Sine wave horizontal wobble
            this.wobbleSpeed = Math.random() * 0.02 + 0.01;
            this.wobbleAmp = Math.random() * 0.6 + 0.2;
            this.angle = Math.random() * Math.PI * 2;

            // Opacity and color variation (Google palette accents)
            const palette = ['#4285F4', '#34A853', '#FBBC05', '#EA4335', '#8ab4f8'];
            this.color = palette[Math.floor(Math.random() * palette.length)];
            this.alpha = Math.random() * 0.45 + 0.25;
        }

        update() {
            this.angle += this.wobbleSpeed;
            this.x += this.vx + Math.sin(this.angle) * this.wobbleAmp;
            this.y += this.vy - scrollSpeed * 0.25;

            // Cursor interaction: Repulsion + vortex wake
            const dx = this.x - mouse.x;
            const dy = this.y - mouse.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < mouse.radius && dist > 0) {
                const force = (1 - dist / mouse.radius) * 3.5;
                const nx = dx / dist;
                const ny = dy / dist;

                this.x += nx * force * 2.5 + mouse.vx * 0.15;
                this.y += ny * force * 2.5 + mouse.vy * 0.15;
                this.size = this.baseSize * 1.6;
            } else {
                this.size += (this.baseSize - this.size) * 0.1;
            }

            // Boundary wrapping
            if (this.y < -20) this.y = height + 10;
            if (this.y > height + 20) this.y = -10;
            if (this.x < -20) this.x = width + 10;
            if (this.x > width + 20) this.x = -10;
        }

        draw() {
            const isDark = currentTheme === 'dark';
            ctx.save();
            ctx.globalAlpha = isDark ? this.alpha : this.alpha * 0.6;
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    function init() {
        canvas = document.getElementById('antigravity-bg-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'antigravity-bg-canvas';
            canvas.style.position = 'fixed';
            canvas.style.top = '0';
            canvas.style.left = '0';
            canvas.style.width = '100vw';
            canvas.style.height = '100vh';
            canvas.style.pointerEvents = 'none';
            canvas.style.zIndex = '0';
            document.body.prepend(canvas);
        }

        ctx = canvas.getContext('2d');
        currentTheme = (window.PortfolioTheme && window.PortfolioTheme.getActiveTheme()) || 'dark';

        resize();
        window.addEventListener('resize', resize, { passive: true });

        // Mouse tracking
        window.addEventListener('mousemove', onMouseMove, { passive: true });
        window.addEventListener('mouseout', () => {
            mouse.x = -1000;
            mouse.y = -1000;
        }, { passive: true });

        // Scroll tracking
        window.addEventListener('scroll', onScroll, { passive: true });

        // Theme tracking
        window.addEventListener('themechange', (e) => {
            currentTheme = e.detail.activeTheme;
        });

        // Spawn particles
        particles = [];
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            particles.push(new Particle());
        }

        animate();
    }

    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    }

    function onMouseMove(e) {
        mouse.vx = e.clientX - mouse.lastX;
        mouse.vy = e.clientY - mouse.lastY;
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        mouse.lastX = e.clientX;
        mouse.lastY = e.clientY;
        mouse.isMoving = true;

        clearTimeout(mouseTimeout);
        mouseTimeout = setTimeout(() => {
            mouse.vx = 0;
            mouse.vy = 0;
            mouse.isMoving = false;
        }, 120);
    }

    function onScroll() {
        scrollY = window.scrollY;
        scrollSpeed = scrollY - lastScrollY;
        lastScrollY = scrollY;
    }

    function drawConnections() {
        const isDark = currentTheme === 'dark';
        const strokeColor = isDark ? 'rgba(66, 133, 244, ' : 'rgba(26, 115, 232, ';

        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < CONNECT_DISTANCE) {
                    const alpha = (1 - dist / CONNECT_DISTANCE) * (isDark ? 0.16 : 0.08);
                    ctx.strokeStyle = `${strokeColor}${alpha})`;
                    ctx.lineWidth = 0.8;
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.stroke();
                }
            }
        }
    }

    function animate() {
        ctx.clearRect(0, 0, width, height);

        // Decay scroll velocity smoothly
        scrollSpeed *= 0.92;

        // Draw connecting threads
        drawConnections();

        // Update and draw particles
        for (let i = 0; i < particles.length; i++) {
            particles[i].update();
            particles[i].draw();
        }

        requestAnimationFrame(animate);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
