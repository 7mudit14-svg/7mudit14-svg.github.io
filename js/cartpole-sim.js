/**
 * High-Precision Cartpole Dynamical Simulation & Dual Oscilloscope Telemetry
 * Based directly on Mudit Todi's research: "Cartpole — From IMC-PID to Robust MRAC"
 * Repository: https://github.com/7mudit14-svg/Cartpole_IMC_MRAC
 *
 * Exact MuJoCo InvertedPendulum-v5 Physics & Model Equations:
 * - Cart Mass M = 10.4720 kg
 * - Pole Mass m = 5.0186 kg
 * - Half-Length l = 0.300 m
 * - Gravity g = 9.81 m/s^2
 * - Joint Damping b = 0.10 N·m·s/rad
 * - Actuator Force Clip: ±300 N (3.0 * 100 gear ratio)
 * - Rail limits x ∈ [-0.95, 0.95] m
 *
 * Controllers:
 * 1. Robust MRAC: Online Kx adaptation + W neural basis [1, sinθ, cosθ, tanh(ẋ)] with σ-mod
 * 2. Standard MRAC: Online Kx adaptation against stable reference model (poles {-2±2j, -8, -9})
 * 3. Cascaded IMC-PID: Analytically derived outer position loop + inner angle loop
 */

(function () {
    let simCanvas, simCtx;
    let graphCanvas, graphCtx;
    let animId = null;
    let isInView = false;
    let lastFrameTime = 0;
    let accumulator = 0;
    let idleFrames = 0;

    // Simulation State Flag: Starts PAUSED by default
    let isRunning = false;

    // Physical Constants from Mudit's MuJoCo Model (am_calculation.py)
    const M = 10.4720;
    const m = 5.0186;
    const l = 0.300;
    const g = 9.81;
    const b = 0.10; // Joint damping
    const TOTAL_MASS = M + m;
    const ML = m * l;
    const U_MAX = 300.0; // N (actuator maximum force after 100x gear)
    const RAIL_LIMIT = 0.95; // m

    // State Space Order: [x (m), x_dot (m/s), theta (rad), theta_dot (rad/s)]
    // Initial condition: starts with a small positive angle (+3.4 degrees)
    const INITIAL_STATE = [0.0, 0.0, 0.06, 0.0];
    let state = [...INITIAL_STATE];
    let controlU = 0.0;
    let disturbancePulse = 0.0;
    let cumulativeISE = 0.0;
    let isFallen = false;

    let selectedController = 'robust_mrac';
    let kickMagnitude = 0.5; // m/s velocity kick

    // Reference Model Matrices (eigenvalues at {-2±2j, -8, -9})
    const AM = [
        [0.0, 1.0, 0.0, 0.0],
        [13.1899, 9.7092, 61.4579, 9.2128],
        [0.0, 0.0, 0.0, 1.0],
        [-43.9663, -32.3641, -161.1899, -30.7092]
    ];
    const BM = [0.0, 0.0955, 0.0, -0.3183];
    const P_MAT = [
        [2.2111, 0.8567, 2.4832, 0.2684],
        [0.8567, 0.8539, 2.5898, 0.2981],
        [2.4832, 2.5898, 10.4775, 0.9905],
        [0.2684, 0.2981, 0.9905, 0.1380]
    ];
    const BM_NORM_SQ = 0.0955 * 0.0955 + (-0.3183) * (-0.3183); // 0.11043

    let xm = [...INITIAL_STATE];

    // Baseline Gains from Pole Placement:
    // u = Kx[0]*x + Kx[1]*x_dot + Kx[2]*theta + Kx[3]*theta_dot
    const NOMINAL_KX = [9.133, 33.522, 310.651, 35.399];
    const NOMINAL_W = [-0.04, -0.0075, -0.04, 0.002];

    let Kx = [...NOMINAL_KX];
    let W = [...NOMINAL_W];

    // Cascaded PID memory
    let integral_x = 0.0;
    let integral_th = 0.0;

    // Oscilloscope History Buffer
    const HISTORY_LENGTH = 300;
    const historyTheta = new Array(HISTORY_LENGTH).fill(0.0);
    const historyX = new Array(HISTORY_LENGTH).fill(0.0);

    function init() {
        simCanvas = document.getElementById('cartpole-viewport-canvas');
        graphCanvas = document.getElementById('cartpole-graph-canvas');
        if (!simCanvas || !graphCanvas) return;

        simCtx = simCanvas.getContext('2d');
        graphCtx = graphCanvas.getContext('2d');

        resize();
        window.addEventListener('resize', resize, { passive: true });

        // Setup Controls
        setupControls();

        // Initial render while paused
        renderCartpole();
        renderOscilloscope();
        updateHUD();

        // Main animation loop: only runs while the lab is on screen and the tab is visible
        const labCard = simCanvas.closest('.cartpole-lab-card') || simCanvas;
        const io = new IntersectionObserver((entries) => {
            isInView = entries[0].isIntersecting;
            if (isInView) startLoop();
        }, { rootMargin: '100px 0px' });
        io.observe(labCard);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) startLoop();
        });
    }

    function startLoop() {
        if (animId === null && isInView && !document.hidden) {
            lastFrameTime = performance.now();
            accumulator = 0;
            animId = requestAnimationFrame(loop);
        }
    }

    function setupControls() {
        // 1. Play / Pause Toggle Button
        const toggleBtn = document.getElementById('cartpole-toggle-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                isRunning = !isRunning;
                updatePlayButtonUI(toggleBtn);
            });
        }

        // 2. Reset Button
        const resetBtn = document.getElementById('cartpole-reset-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', resetSimulation);
        }

        // 3. Controller Select
        const selectEl = document.getElementById('cartpole-controller-select');
        if (selectEl) {
            selectEl.addEventListener('change', (e) => {
                selectedController = e.target.value;
                updateControllerBadge();
            });
        }

        // 4. Kick Injector
        const kickBtn = document.getElementById('cartpole-kick-btn');
        if (kickBtn) {
            kickBtn.addEventListener('click', () => {
                injectVelocityKick(kickMagnitude);
            });
        }

        // 5. Kick Slider
        const sliderEl = document.getElementById('cartpole-kick-slider');
        const sliderValEl = document.getElementById('cartpole-kick-val');
        if (sliderEl && sliderValEl) {
            sliderEl.addEventListener('input', (e) => {
                kickMagnitude = parseFloat(e.target.value);
                sliderValEl.textContent = `+${kickMagnitude.toFixed(1)} m/s`;
            });
        }
    }

    function updatePlayButtonUI(btn) {
        if (!btn) btn = document.getElementById('cartpole-toggle-btn');
        if (!btn) return;

        if (isRunning) {
            btn.innerHTML = `
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16"/>
                    <rect x="14" y="4" width="4" height="16"/>
                </svg>
                <span>Pause</span>
            `;
            btn.className = 'btn btn-outline';
            btn.style.color = 'var(--accent-warning)';
            btn.style.borderColor = 'var(--accent-warning)';
        } else {
            btn.innerHTML = `
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                <span>Start Simulation</span>
            `;
            btn.className = 'btn btn-primary';
            btn.style.color = '';
            btn.style.borderColor = '';
        }
    }

    // Size the backing store at devicePixelRatio so lines stay crisp on phones / retina screens.
    // Drawing code keeps working in CSS pixels via cssW / cssH and the context transform.
    function sizeCanvas(canvas, ctx, fallbackH) {
        if (!canvas || !canvas.parentElement) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = canvas.parentElement.clientWidth;
        const h = canvas.clientHeight || canvas.parentElement.clientHeight || fallbackH;
        canvas.cssW = w;
        canvas.cssH = h;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function resize() {
        sizeCanvas(simCanvas, simCtx, 240);
        sizeCanvas(graphCanvas, graphCtx, 180);
        if (simCtx && graphCtx) {
            renderCartpole();
            renderOscilloscope();
        }
    }

    function resetSimulation() {
        state = [...INITIAL_STATE];
        xm = [...INITIAL_STATE];
        controlU = 0.0;
        disturbancePulse = 0.0;
        cumulativeISE = 0.0;
        isFallen = false;

        Kx = [...NOMINAL_KX];
        W = [...NOMINAL_W];
        integral_x = 0.0;
        integral_th = 0.0;

        historyTheta.fill(0.0);
        historyX.fill(0.0);

        renderCartpole();
        renderOscilloscope();
        updateHUD();
    }

    function injectVelocityKick(kickVal) {
        state[1] += kickVal; // Add instantaneous velocity impulse to cart
        disturbancePulse = 1.0;
        if (!isRunning) {
            isRunning = true;
            updatePlayButtonUI();
        }
    }

    function updateControllerBadge() {
        const badge = document.getElementById('cartpole-active-badge');
        if (!badge) return;
        if (selectedController === 'robust_mrac') {
            badge.textContent = 'Robust MRAC (σ-mod + α(x))';
            badge.className = 'status-chip success';
        } else if (selectedController === 'mrac') {
            badge.textContent = 'Standard MRAC (Online Kx)';
            badge.className = 'status-chip blue';
        } else {
            badge.textContent = 'Cascaded IMC-PID (Fixed Baseline)';
            badge.className = 'status-chip';
        }
    }

    /**
     * Exact Nonlinear Lagrangian Equations of Motion from Mudit's Derivation:
     * (M + m) x_ddot + m*l*cos(theta)*theta_ddot - m*l*theta_dot^2*sin(theta) = u
     * l*theta_ddot + cos(theta)*x_ddot - g*sin(theta) + (b/(m*l))*theta_dot = 0
     *
     * Matrix formulation:
     * [ (M+m),    m*l*cosT ] [ x_ddot     ] = [ u + m*l*theta_dot^2*sinT ]
     * [ cosT,     l        ] [ theta_ddot ]   [ g*sinT - (b/(m*l))*theta_dot ]
     */
    function computeDerivatives(s, u) {
        const x = s[0];
        const x_dot = s[1];
        const theta = s[2];
        const theta_dot = s[3];

        const sinT = Math.sin(theta);
        const cosT = Math.cos(theta);

        const A11 = TOTAL_MASS;
        const A12 = ML * cosT;
        const A21 = cosT;
        const A22 = l;

        const B1 = u + ML * (theta_dot * theta_dot) * sinT;
        const B2 = g * sinT - (b / ML) * theta_dot;

        const det = l * (M + m * sinT * sinT);

        const x_ddot = (A22 * B1 - A12 * B2) / det;
        const theta_ddot = (-A21 * B1 + A11 * B2) / det;

        return [x_dot, x_ddot, theta_dot, theta_ddot];
    }

    /**
     * 4th-Order Runge-Kutta (RK4) Step
     */
    function rk4Step(dt, u) {
        const k1 = computeDerivatives(state, u);

        const s2 = [
            state[0] + 0.5 * dt * k1[0],
            state[1] + 0.5 * dt * k1[1],
            state[2] + 0.5 * dt * k1[2],
            state[3] + 0.5 * dt * k1[3]
        ];
        const k2 = computeDerivatives(s2, u);

        const s3 = [
            state[0] + 0.5 * dt * k2[0],
            state[1] + 0.5 * dt * k2[1],
            state[2] + 0.5 * dt * k2[2],
            state[3] + 0.5 * dt * k2[3]
        ];
        const k3 = computeDerivatives(s3, u);

        const s4 = [
            state[0] + dt * k3[0],
            state[1] + dt * k3[1],
            state[2] + dt * k3[2],
            state[3] + dt * k3[3]
        ];
        const k4 = computeDerivatives(s4, u);

        for (let i = 0; i < 4; i++) {
            state[i] += (dt / 6.0) * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]);
        }

        // Rail Limit Bumper Elastic Collisions (damping on impact)
        if (state[0] > RAIL_LIMIT) {
            state[0] = RAIL_LIMIT;
            state[1] = -Math.abs(state[1]) * 0.35;
        } else if (state[0] < -RAIL_LIMIT) {
            state[0] = -RAIL_LIMIT;
            state[1] = Math.abs(state[1]) * 0.35;
        }

        // Fall check (exceeded recoverable physical envelope > 65 deg)
        if (Math.abs(state[2]) > 1.15) {
            isFallen = true;
        }
    }

    function updatePhysics() {
        if (!isRunning || isFallen) return;

        // Sub-stepping: 8 RK4 iterations per visual frame (500 Hz numerical accuracy)
        const subSteps = 8;
        const dtSub = (1.0 / 60.0) / subSteps;

        for (let step = 0; step < subSteps; step++) {
            const x = state[0];
            const x_dot = state[1];
            const theta = state[2];
            const theta_dot = state[3];

            // 1. Step Reference Model for MRAC variants
            const dxm = [
                AM[0][0] * xm[0] + AM[0][1] * xm[1] + AM[0][2] * xm[2] + AM[0][3] * xm[3],
                AM[1][0] * xm[0] + AM[1][1] * xm[1] + AM[1][2] * xm[2] + AM[1][3] * xm[3],
                AM[2][0] * xm[0] + AM[2][1] * xm[1] + AM[2][2] * xm[2] + AM[2][3] * xm[3],
                AM[3][0] * xm[0] + AM[3][1] * xm[1] + AM[3][2] * xm[2] + AM[3][3] * xm[3]
            ];
            for (let i = 0; i < 4; i++) {
                xm[i] += dxm[i] * dtSub;
            }

            // Tracking error e = x_plant - xm
            const e0 = state[0] - xm[0];
            const e1 = state[1] - xm[1];
            const e2 = state[2] - xm[2];
            const e3 = state[3] - xm[3];

            // Lyapunov sensitivity: ePB = (e^T * P * Bm) / ||Bm||^2
            const eP0 = e0 * P_MAT[0][0] + e1 * P_MAT[1][0] + e2 * P_MAT[2][0] + e3 * P_MAT[3][0];
            const eP1 = e0 * P_MAT[0][1] + e1 * P_MAT[1][1] + e2 * P_MAT[2][1] + e3 * P_MAT[3][1];
            const eP2 = e0 * P_MAT[0][2] + e1 * P_MAT[1][2] + e2 * P_MAT[2][2] + e3 * P_MAT[3][2];
            const eP3 = e0 * P_MAT[0][3] + e1 * P_MAT[1][3] + e2 * P_MAT[2][3] + e3 * P_MAT[3][3];

            const ePB = (eP0 * BM[0] + eP1 * BM[1] + eP2 * BM[2] + eP3 * BM[3]) / BM_NORM_SQ;
            const eNorm = Math.sqrt(e0 * e0 + e1 * e1 + e2 * e2 + e3 * e3);

            // Nonlinear basis: alpha(x) = [1, sinθ, cosθ, tanh(ẋ)]
            const a0 = 1.0;
            const a1 = Math.sin(theta);
            const a2 = Math.cos(theta);
            const a3 = Math.tanh(x_dot);

            // 2. Controller Law
            if (selectedController === 'robust_mrac') {
                // Robust MRAC: u = Kx*x + u_ad, where u_ad = -W^T * alpha(x)
                const u_nominal = Kx[0] * x + Kx[1] * x_dot + Kx[2] * theta + Kx[3] * theta_dot;
                const u_ad = -(W[0] * a0 + W[1] * a1 + W[2] * a2 + W[3] * a3);
                controlU = Math.max(-U_MAX, Math.min(U_MAX, u_nominal + u_ad));

                // Online adaptation with σ-modification on W
                const gamma_x = 0.01;
                const gamma_w = 2.5;
                const sigma_w = 0.05;

                for (let i = 0; i < 4; i++) {
                    Kx[i] += -gamma_x * ePB * state[i] * dtSub;
                }
                W[0] += (gamma_w * ePB * a0 - sigma_w * eNorm * W[0]) * dtSub;
                W[1] += (gamma_w * ePB * a1 - sigma_w * eNorm * W[1]) * dtSub;
                W[2] += (gamma_w * ePB * a2 - sigma_w * eNorm * W[2]) * dtSub;
                W[3] += (gamma_w * ePB * a3 - sigma_w * eNorm * W[3]) * dtSub;

            } else if (selectedController === 'mrac') {
                // Standard MRAC: u = Kx*x (no robust basis term)
                const u_nominal = Kx[0] * x + Kx[1] * x_dot + Kx[2] * theta + Kx[3] * theta_dot;
                controlU = Math.max(-U_MAX, Math.min(U_MAX, u_nominal));

                const gamma_x = 0.01;
                for (let i = 0; i < 4; i++) {
                    Kx[i] += -gamma_x * ePB * state[i] * dtSub;
                }

            } else {
                // Cascaded IMC-PID (from Mudit's IMC_PID/main/pose_angle_main.py)
                // Outer loop (cart position to reference lean angle theta_ref):
                integral_x += (0.0 - x) * dtSub;
                integral_x = Math.max(-1.0, Math.min(1.0, integral_x));
                const theta_ref = Math.max(-0.08, Math.min(0.08, -0.045 * x - 0.012 * integral_x - 0.02 * x_dot));

                // Inner loop (angle error to force):
                const e_theta = theta_ref - theta;
                integral_th += e_theta * dtSub;
                integral_th = Math.max(-0.25, Math.min(0.25, integral_th));

                const u_pid = 310.0 * (-e_theta) + 35.0 * theta_dot - 40.0 * integral_th;
                controlU = Math.max(-U_MAX, Math.min(U_MAX, u_pid));
            }

            // Numerical integration step
            rk4Step(dtSub, controlU);
            cumulativeISE += (theta * theta) * dtSub;
        }

        disturbancePulse = Math.max(0, disturbancePulse - 0.03);

        // Record history for oscilloscope
        historyTheta.push(state[2]);
        historyX.push(state[0]);
        if (historyTheta.length > HISTORY_LENGTH) historyTheta.shift();
        if (historyX.length > HISTORY_LENGTH) historyX.shift();

        updateHUD();
    }

    function updateHUD() {
        const angleValEl = document.getElementById('cartpole-telemetry-angle');
        const posValEl = document.getElementById('cartpole-telemetry-pos');
        const uValEl = document.getElementById('cartpole-telemetry-u');
        const iseValEl = document.getElementById('cartpole-telemetry-ise');

        if (angleValEl) angleValEl.textContent = `${(state[2] * 57.2958).toFixed(2)}°`;
        if (posValEl) posValEl.textContent = `${state[0].toFixed(3)} m`;
        if (uValEl) uValEl.textContent = `${controlU.toFixed(1)} N`;
        if (iseValEl) iseValEl.textContent = cumulativeISE.toFixed(3);
    }

    function renderCartpole() {
        const w = simCanvas.cssW || simCanvas.width;
        const h = simCanvas.cssH || simCanvas.height;
        simCtx.clearRect(0, 0, w, h);

        const isDark = (window.PortfolioTheme && window.PortfolioTheme.getActiveTheme()) === 'dark';

        const railY = h * 0.72;
        const centerX = w * 0.5;
        const scale = Math.min(w * 0.42, 230); // pixels per 1.0 meter

        // 1. Draw Linear Guide Rail
        simCtx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.16)';
        simCtx.lineWidth = 4;
        simCtx.lineCap = 'round';
        simCtx.beginPath();
        simCtx.moveTo(centerX - scale * 1.05, railY);
        simCtx.lineTo(centerX + scale * 1.05, railY);
        simCtx.stroke();

        // Ruler Tick marks
        simCtx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.25)';
        simCtx.font = '9px JetBrains Mono, monospace';
        simCtx.textAlign = 'center';
        for (let mPos = -1.0; mPos <= 1.0; mPos += 0.25) {
            const tx = centerX + mPos * scale;
            simCtx.fillRect(tx - 0.5, railY - 4, 1, 8);
            if (mPos === -1.0 || mPos === -0.5 || mPos === 0.0 || mPos === 0.5 || mPos === 1.0) {
                simCtx.fillText(`${mPos.toFixed(1)}m`, tx, railY + 16);
            }
        }

        // Rail Limit End Stops (±1.0m)
        simCtx.fillStyle = isDark ? '#EA4335' : '#d93025';
        simCtx.fillRect(centerX - scale - 3, railY - 14, 6, 28);
        simCtx.fillRect(centerX + scale - 3, railY - 14, 6, 28);

        // 2. Cart Body
        const cartScreenX = centerX + state[0] * scale;
        const cartW = 56;
        const cartH = 26;

        // Disturbance flash shockwave effect
        if (disturbancePulse > 0.02) {
            simCtx.save();
            simCtx.strokeStyle = `rgba(234, 67, 53, ${disturbancePulse})`;
            simCtx.lineWidth = 2.5;
            simCtx.beginPath();
            simCtx.arc(cartScreenX, railY - cartH / 2, 45 * (1.6 - disturbancePulse), 0, Math.PI * 2);
            simCtx.stroke();
            simCtx.restore();
        }

        // Cart Box
        simCtx.save();
        simCtx.fillStyle = isDark ? '#22272e' : '#e6ebf2';
        simCtx.strokeStyle = isDark ? '#4285F4' : '#1a73e8';
        simCtx.lineWidth = 2;
        simCtx.beginPath();
        simCtx.roundRect(cartScreenX - cartW / 2, railY - cartH, cartW, cartH, 6);
        simCtx.fill();
        simCtx.stroke();

        // Cart Wheels
        simCtx.fillStyle = isDark ? '#111418' : '#57606a';
        simCtx.beginPath();
        simCtx.arc(cartScreenX - 16, railY + 1, 5, 0, Math.PI * 2);
        simCtx.arc(cartScreenX + 16, railY + 1, 5, 0, Math.PI * 2);
        simCtx.fill();

        // Pivot Center
        const pivotX = cartScreenX;
        const pivotY = railY - cartH;
        simCtx.fillStyle = isDark ? '#f0f6fc' : '#24292f';
        simCtx.beginPath();
        simCtx.arc(pivotX, pivotY, 6, 0, Math.PI * 2);
        simCtx.fill();

        // 3. Pendulum Pole (Length = 2 * l = 0.6m in visual scale ~ 95px)
        const poleLenPx = 95;
        const theta = state[2];
        const tipX = pivotX + Math.sin(theta) * poleLenPx;
        const tipY = pivotY - Math.cos(theta) * poleLenPx;

        // Pole Bar
        simCtx.strokeStyle = isDark ? '#c9d1d9' : '#33383f';
        simCtx.lineWidth = 5;
        simCtx.lineCap = 'round';
        simCtx.beginPath();
        simCtx.moveTo(pivotX, pivotY);
        simCtx.lineTo(tipX, tipY);
        simCtx.stroke();

        // Pole Tip Bob (Color-coded by active controller)
        const tipColor = selectedController === 'robust_mrac' ? '#34A853' :
            (selectedController === 'mrac' ? '#4285F4' : '#FBBC05');
        simCtx.fillStyle = tipColor;
        simCtx.beginPath();
        simCtx.arc(tipX, tipY, 7, 0, Math.PI * 2);
        simCtx.fill();

        // Tip Glow Halo
        simCtx.fillStyle = tipColor;
        simCtx.globalAlpha = 0.25;
        simCtx.beginPath();
        simCtx.arc(tipX, tipY, 15, 0, Math.PI * 2);
        simCtx.fill();
        simCtx.restore();

        // 4. Thrust Force Arrow
        if (Math.abs(controlU) > 2.0) {
            simCtx.save();
            const arrowLen = Math.max(-50, Math.min(50, (controlU / 150.0) * 45));
            simCtx.strokeStyle = '#4285F4';
            simCtx.fillStyle = '#4285F4';
            simCtx.lineWidth = 2.5;
            simCtx.beginPath();
            simCtx.moveTo(cartScreenX, railY - cartH / 2);
            simCtx.lineTo(cartScreenX + arrowLen, railY - cartH / 2);
            simCtx.stroke();
            simCtx.restore();
        }

        // Overlay status text if paused or fallen
        if (!isRunning) {
            simCtx.save();
            simCtx.fillStyle = isDark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.55)';
            simCtx.fillRect(0, 0, w, h);
            simCtx.fillStyle = isDark ? '#f0f6fc' : '#1f2328';
            simCtx.font = '600 13px Plus Jakarta Sans, sans-serif';
            simCtx.textAlign = 'center';
            simCtx.fillText('Simulation Paused — Click "Start Simulation" to balance', w * 0.5, h * 0.32);
            simCtx.restore();
        } else if (isFallen) {
            simCtx.save();
            simCtx.fillStyle = '#EA4335';
            simCtx.font = '700 13px JetBrains Mono, monospace';
            simCtx.textAlign = 'center';
            simCtx.fillText('⚠️ POLE EXCEEDED STABILITY BOUND (>65°) — CLICK RESET', w * 0.5, h * 0.32);
            simCtx.restore();
        }
    }

    function renderOscilloscope() {
        const w = graphCanvas.cssW || graphCanvas.width;
        const h = graphCanvas.cssH || graphCanvas.height;
        graphCtx.clearRect(0, 0, w, h);

        const isDark = (window.PortfolioTheme && window.PortfolioTheme.getActiveTheme()) === 'dark';

        // Background
        graphCtx.fillStyle = isDark ? 'rgba(10, 12, 16, 0.88)' : 'rgba(248, 250, 253, 0.88)';
        graphCtx.fillRect(0, 0, w, h);

        // Grid
        graphCtx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';
        graphCtx.lineWidth = 1;
        for (let x = 0; x < w; x += 40) {
            graphCtx.beginPath();
            graphCtx.moveTo(x, 0);
            graphCtx.lineTo(x, h);
            graphCtx.stroke();
        }
        for (let y = 0; y < h; y += 30) {
            graphCtx.beginPath();
            graphCtx.moveTo(0, y);
            graphCtx.lineTo(w, y);
            graphCtx.stroke();
        }

        // Center Reference Line
        const midY = h * 0.5;
        graphCtx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.22)';
        graphCtx.setLineDash([3, 3]);
        graphCtx.beginPath();
        graphCtx.moveTo(0, midY);
        graphCtx.lineTo(w, midY);
        graphCtx.stroke();
        graphCtx.setLineDash([]);

        // Legend
        graphCtx.font = '10px JetBrains Mono, monospace';
        graphCtx.fillStyle = '#34A853';
        graphCtx.fillText('— Pole Angle θ(t)', 12, 16);
        graphCtx.fillStyle = '#4285F4';
        graphCtx.fillText('— Cart Position x(t)', 160, 16);

        // Draw Angle Trace θ(t)
        graphCtx.strokeStyle = '#34A853';
        graphCtx.lineWidth = 2;
        graphCtx.beginPath();
        for (let i = 0; i < historyTheta.length; i++) {
            const gx = (i / (HISTORY_LENGTH - 1)) * w;
            const gy = midY - historyTheta[i] * 180;
            if (i === 0) graphCtx.moveTo(gx, gy);
            else graphCtx.lineTo(gx, gy);
        }
        graphCtx.stroke();

        // Draw Cart Position Trace x(t)
        graphCtx.strokeStyle = '#4285F4';
        graphCtx.lineWidth = 1.5;
        graphCtx.beginPath();
        for (let i = 0; i < historyX.length; i++) {
            const gx = (i / (HISTORY_LENGTH - 1)) * w;
            const gy = midY - historyX[i] * 70;
            if (i === 0) graphCtx.moveTo(gx, gy);
            else graphCtx.lineTo(gx, gy);
        }
        graphCtx.stroke();
    }

    // Fixed 60 Hz physics step decoupled from the display refresh rate,
    // so the sim runs at real-time speed on 60 / 90 / 120 / 144 Hz screens alike.
    function loop(now) {
        if (!isInView || document.hidden) {
            animId = null;
            return;
        }
        const STEP_MS = 1000 / 60;
        accumulator += Math.min(now - lastFrameTime, 100);
        lastFrameTime = now;

        let stepped = false;
        while (accumulator >= STEP_MS) {
            updatePhysics();
            accumulator -= STEP_MS;
            stepped = true;
        }

        // While paused, a slow ~10 Hz redraw is enough to pick up theme / control changes
        if (stepped || (!isRunning && (idleFrames++ % 6) === 0)) {
            renderCartpole();
            renderOscilloscope();
        }
        animId = requestAnimationFrame(loop);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
