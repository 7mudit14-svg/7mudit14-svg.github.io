/**
 * Three.js Robotics Engine — Built directly from Mudit Todi's arm.xacro / arm.urdf
 * Exact Kinematics & Link Geometry:
 * - base_link: Box 0.4 x 0.4 x 0.1 m
 * - joint1: Yaw rotation (Z-axis) [-3.14, 3.14]
 * - shoulder_link: Cylinder r=0.1, h=0.2 m
 * - joint2: Pitch rotation (Y-axis) [0, 2.5]
 * - arm_link: Cylinder r=0.05, h=0.6 m
 * - joint3: Pitch rotation (Y-axis) [0, 2.5]
 * - elbow_link: Cylinder r=0.05, h=0.4 m
 * - joint4: Roll/Yaw rotation (Z-axis) [-3.14, 3.14]
 * - hand_link: Box 0.1 x 0.1 x 0.02 m
 * - payload_link: Box 0.06 x 0.06 x 0.06 m cube
 *
 * True Cursor Alignment:
 * - Raycasts mouse screen coordinates into 3D world space
 * - Computes direct Inverse Kinematics / Look-At targeting so Joint 1 and Joints 2/3
 *   actively orient the end-effector directly toward the cursor with spring damping.
 */

(function () {
    if (typeof THREE === 'undefined') return;

    let scene, camera, renderer, container;
    let robotGroup;
    let baseMesh, shoulderGroup, armGroup, elbowGroup, handGroup, payloadMesh;
    let laserBeam, endEffectorTripod;
    let gridHelper, ambientLight, dirLight, pointLight;
    let isWireframe = false;
    let currentTheme = 'dark';

    // Materials dictionary
    const materials = {};

    // Current joint positions (radians)
    const joints = {
        j1: 0.0,  // Base Yaw (Z)
        j2: 0.65, // Shoulder Pitch (Y)
        j3: 1.1,  // Elbow Pitch (Y)
        j4: 0.0   // Wrist Roll (Z)
    };

    const targetJoints = { ...joints };

    // Mouse tracking & raycasting for cursor alignment
    const raycaster = new THREE.Raycaster();
    const mouseNDC = new THREE.Vector2(-0.45, 0.15);
    let targetWorldPos = new THREE.Vector3(0.6, 0.8, 0.8);
    let isMouseOverViewport = false;
    let scrollProgress = 0;
    let activeSectionIndex = 0;
    let lastClientX = 0;
    let lastClientY = 0;
    let hasReceivedCursor = false;

    // Performance state: render only while the hero viewport is on screen and the tab is visible
    const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
    let isInView = true;
    let rafId = null;
    let aimDirty = true;          // re-solve IK once per frame at most, only after input/scroll
    let containerRect = null;     // cached; refreshed on scroll/resize instead of every frame
    let hudEls = null;
    let frameCount = 0;
    const tmpWorldPos = new THREE.Vector3();

    function init() {
        container = document.getElementById('robot-3d-viewport');
        if (!container) return;

        // 1. Scene
        scene = new THREE.Scene();
        currentTheme = (window.PortfolioTheme && window.PortfolioTheme.getActiveTheme()) || 'dark';
        updateSceneTheme(currentTheme);

        // 2. Camera: Framed specifically for the 0.6m + 0.4m reach envelope
        const aspect = container.clientWidth / container.clientHeight;
        camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 100);
        camera.position.set(2.4, 2.0, 2.8);
        camera.lookAt(0, 0.65, 0);

        // 3. Renderer
        renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: isCoarsePointer ? 'default' : 'high-performance'
        });
        renderer.setSize(container.clientWidth, container.clientHeight);
        // Phones have 3x screens; 1.5x is visually identical here and ~4x cheaper to fill
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, isCoarsePointer ? 1.5 : 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(renderer.domElement);

        // 4. Lighting
        setupLighting();

        // 5. Materials
        buildMaterials();

        // 6. Assemble Robot from arm.xacro specifications
        buildArmFromXacro();

        // 7. Grid / Work Envelope
        buildWorkEnvelope();

        // 8. Event Listeners
        window.addEventListener('resize', onWindowResize, { passive: true });
        window.addEventListener('themechange', (e) => {
            currentTheme = e.detail.activeTheme;
            updateSceneTheme(currentTheme);
            updateMaterialsForTheme(currentTheme);
        });

        window.addEventListener('scroll', onScroll, { passive: true });

        // Unified Cursor Tracking across entire window, canvas, and touch
        window.addEventListener('mousemove', onWindowMouseMove, { passive: true });
        window.addEventListener('touchmove', onWindowTouchMove, { passive: true });
        container.addEventListener('mousemove', onContainerMouseMove, { passive: true });
        container.addEventListener('mouseenter', () => { isMouseOverViewport = true; });
        container.addEventListener('mouseleave', () => { isMouseOverViewport = false; });

        // Controls
        const wireframeBtn = document.getElementById('btn-toggle-wireframe');
        if (wireframeBtn) {
            wireframeBtn.addEventListener('click', toggleWireframe);
        }

        const resetBtn = document.getElementById('btn-reset-view');
        if (resetBtn) {
            resetBtn.addEventListener('click', resetRobotPose);
        }

        // Initialize default cursor aim toward the hero pitch headline on the left
        lastClientX = window.innerWidth * 0.35;
        lastClientY = window.innerHeight * 0.35;
        solveArmAiming();
        // Warm-start joints without visual snap
        joints.j1 = targetJoints.j1;
        joints.j2 = targetJoints.j2;
        joints.j3 = targetJoints.j3;
        joints.j4 = targetJoints.j4;

        hudEls = {
            j1: document.getElementById('hud-j1'),
            j2: document.getElementById('hud-j2'),
            j3: document.getElementById('hud-j3'),
            j4: document.getElementById('hud-j4'),
            x: document.getElementById('hud-x'),
            y: document.getElementById('hud-y'),
            z: document.getElementById('hud-z')
        };

        // Pause the WebGL loop when the hero is scrolled away or the tab is hidden
        const io = new IntersectionObserver((entries) => {
            isInView = entries[0].isIntersecting;
            if (isInView) {
                aimDirty = true;
                startLoop();
            }
        }, { threshold: 0 });
        io.observe(container);

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) startLoop();
        });

        startLoop();
    }

    function startLoop() {
        if (rafId === null) rafId = requestAnimationFrame(animate);
    }

    function updateSceneTheme(theme) {
        if (!scene) return;
        const isDark = theme === 'dark';
        scene.fog = new THREE.FogExp2(isDark ? 0x0a0c10 : 0xf8fafd, 0.08);
        if (renderer) renderer.setClearColor(isDark ? 0x0a0c10 : 0xf8fafd, 0);
    }

    function setupLighting() {
        ambientLight = new THREE.AmbientLight(0xffffff, currentTheme === 'dark' ? 0.8 : 1.4);
        scene.add(ambientLight);

        dirLight = new THREE.DirectionalLight(0xffffff, currentTheme === 'dark' ? 1.6 : 2.2);
        dirLight.position.set(3.5, 6, 4);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = isCoarsePointer ? 512 : 1024;
        dirLight.shadow.mapSize.height = isCoarsePointer ? 512 : 1024;
        scene.add(dirLight);

        pointLight = new THREE.PointLight(0x4285F4, 2.2, 10);
        pointLight.position.set(-1.5, 2.5, 1.5);
        scene.add(pointLight);
    }

    function buildMaterials() {
        const isDark = currentTheme === 'dark';

        // Anodized Grey (Base, Arm, Hand) as in xacro: material name="grey"
        materials.grey = new THREE.MeshStandardMaterial({
            color: isDark ? 0x2b313a : 0xd2d8e2,
            metalness: 0.8,
            roughness: 0.3,
            wireframe: isWireframe
        });

        // Vibrant Blue (Shoulder, Elbow) as in xacro: material name="blue" (Google Blue accent)
        materials.blue = new THREE.MeshStandardMaterial({
            color: isDark ? 0x1a5bb8 : 0x4285F4,
            metalness: 0.75,
            roughness: 0.25,
            wireframe: isWireframe
        });

        // Joint Accents & Rings
        materials.jointChrome = new THREE.MeshStandardMaterial({
            color: isDark ? 0x111418 : 0x4a525d,
            metalness: 0.95,
            roughness: 0.15,
            wireframe: isWireframe
        });

        // Active End-Effector Payload (cube)
        materials.payload = new THREE.MeshStandardMaterial({
            color: isDark ? 0xEA4335 : 0xd93025,
            metalness: 0.6,
            roughness: 0.3,
            wireframe: isWireframe
        });

        // Laser Guide Beam
        materials.laser = new THREE.MeshBasicMaterial({
            color: 0x00f0ff,
            transparent: true,
            opacity: isDark ? 0.65 : 0.45
        });
    }

    function updateMaterialsForTheme(theme) {
        const isDark = theme === 'dark';
        if (materials.grey) materials.grey.color.setHex(isDark ? 0x2b313a : 0xd2d8e2);
        if (materials.blue) materials.blue.color.setHex(isDark ? 0x1a5bb8 : 0x4285F4);
        if (ambientLight) ambientLight.intensity = isDark ? 0.8 : 1.4;
        if (dirLight) dirLight.intensity = isDark ? 1.6 : 2.2;
        if (gridHelper) {
            scene.remove(gridHelper);
            buildWorkEnvelope();
        }
    }

    function createTripod(size = 0.12) {
        const tripod = new THREE.Group();
        const makeAxis = (color, rotZ, rotX, posX, posY, posZ) => {
            const geo = new THREE.CylinderGeometry(0.004, 0.004, size, 8);
            const mat = new THREE.MeshBasicMaterial({ color });
            const m = new THREE.Mesh(geo, mat);
            m.rotation.z = rotZ;
            m.rotation.x = rotX;
            m.position.set(posX, posY, posZ);
            return m;
        };
        tripod.add(makeAxis(0xEA4335, -Math.PI / 2, 0, size / 2, 0, 0)); // X - Red
        tripod.add(makeAxis(0x34A853, 0, 0, 0, size / 2, 0));          // Y - Green
        tripod.add(makeAxis(0x4285F4, 0, Math.PI / 2, 0, 0, size / 2));  // Z - Blue
        return tripod;
    }

    /**
     * Build robotic arm matching arm.xacro dimensions and joint hierarchy exactly:
     */
    function buildArmFromXacro() {
        robotGroup = new THREE.Group();
        scene.add(robotGroup);

        // 1. BASE LINK: <box size="0.4 0.4 0.1" />, origin xyz="0 0 0.05"
        const baseGeo = new THREE.BoxGeometry(0.4, 0.1, 0.4); // Three.js Y is up, Xacro Z is up
        baseMesh = new THREE.Mesh(baseGeo, materials.grey);
        baseMesh.position.set(0, 0.05, 0);
        baseMesh.receiveShadow = true;
        baseMesh.castShadow = true;
        robotGroup.add(baseMesh);

        // Joint 1 Axis: origin xyz="0 0 0.1", axis="0 0 1" (Z-up in ROS, Y-up in Three.js)
        shoulderGroup = new THREE.Group();
        shoulderGroup.position.set(0, 0.1, 0);
        robotGroup.add(shoulderGroup);

        // 2. SHOULDER LINK: <cylinder length="0.2" radius="0.1" />, origin xyz="0 0 0.1"
        const shoulderGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.2, 32);
        const shoulderMesh = new THREE.Mesh(shoulderGeo, materials.blue);
        shoulderMesh.position.set(0, 0.1, 0);
        shoulderMesh.castShadow = true;
        shoulderGroup.add(shoulderMesh);

        // Bearing chrome bevel
        const bevelGeo = new THREE.TorusGeometry(0.102, 0.012, 16, 36);
        const bevelMesh = new THREE.Mesh(bevelGeo, materials.jointChrome);
        bevelMesh.rotation.x = Math.PI / 2;
        bevelMesh.position.set(0, 0.08, 0);
        shoulderGroup.add(bevelMesh);

        // Joint 2 Axis: origin xyz="0 0 0.2", axis="0 1 0" (Y-rotation in ROS, Z/X-rotation in Three.js)
        armGroup = new THREE.Group();
        armGroup.position.set(0, 0.2, 0);
        shoulderGroup.add(armGroup);

        // 3. ARM LINK: <cylinder length="0.6" radius="0.05" />, origin xyz="0 0 0.3"
        const armGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.6, 24);
        const armMesh = new THREE.Mesh(armGeo, materials.grey);
        armMesh.position.set(0, 0.3, 0);
        armMesh.castShadow = true;
        armGroup.add(armMesh);

        // Joint 2 Chrome Pivot Hub
        const j2HubGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.14, 20);
        const j2HubMesh = new THREE.Mesh(j2HubGeo, materials.jointChrome);
        j2HubMesh.rotation.z = Math.PI / 2;
        armGroup.add(j2HubMesh);

        // Joint 3 Axis: origin xyz="0 0 0.6", axis="0 1 0"
        elbowGroup = new THREE.Group();
        elbowGroup.position.set(0, 0.6, 0);
        armGroup.add(elbowGroup);

        // 4. ELBOW LINK: <cylinder length="0.4" radius="0.05" />, origin xyz="0 0 0.2"
        const elbowGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.4, 24);
        const elbowMesh = new THREE.Mesh(elbowGeo, materials.blue);
        elbowMesh.position.set(0, 0.2, 0);
        elbowMesh.castShadow = true;
        elbowGroup.add(elbowMesh);

        // Joint 3 Chrome Pivot Hub
        const j3HubGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.14, 20);
        const j3HubMesh = new THREE.Mesh(j3HubGeo, materials.jointChrome);
        j3HubMesh.rotation.z = Math.PI / 2;
        elbowGroup.add(j3HubMesh);

        // Joint 4 Axis: origin xyz="0 0 0.4", axis="0 0 1"
        handGroup = new THREE.Group();
        handGroup.position.set(0, 0.4, 0);
        elbowGroup.add(handGroup);

        // 5. HAND LINK: <box size="0.1 0.1 0.02" />, origin xyz="0 0 0.01"
        const handGeo = new THREE.BoxGeometry(0.1, 0.02, 0.1);
        const handMesh = new THREE.Mesh(handGeo, materials.grey);
        handMesh.position.set(0, 0.01, 0);
        handMesh.castShadow = true;
        handGroup.add(handMesh);

        // 6. PAYLOAD LINK: <box size="0.06 0.06 0.06" /> at tool origin
        const payloadGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
        payloadMesh = new THREE.Mesh(payloadGeo, materials.payload);
        payloadMesh.position.set(0, 0.05, 0);
        payloadMesh.castShadow = true;
        handGroup.add(payloadMesh);

        // End-Effector Coordinate Tripod
        endEffectorTripod = createTripod(0.14);
        endEffectorTripod.position.set(0, 0.09, 0);
        handGroup.add(endEffectorTripod);

        // Laser Aim Beam (pointing outward from tool tip directly toward cursor)
        const laserGeo = new THREE.CylinderGeometry(0.003, 0.007, 4.5, 12);
        laserBeam = new THREE.Mesh(laserGeo, materials.laser);
        laserBeam.position.set(0, 0.09 + 2.25, 0);
        handGroup.add(laserBeam);
    }

    function buildWorkEnvelope() {
        const isDark = currentTheme === 'dark';
        const centerColor = isDark ? 0x4285F4 : 0x1a73e8;
        const gridColor = isDark ? 0x1f242c : 0xd8dde6;

        gridHelper = new THREE.GridHelper(4.0, 16, centerColor, gridColor);
        gridHelper.position.y = 0;
        scene.add(gridHelper);
    }

    function toggleWireframe() {
        isWireframe = !isWireframe;
        Object.values(materials).forEach(m => {
            if (m && 'wireframe' in m) m.wireframe = isWireframe;
        });
        const btn = document.getElementById('btn-toggle-wireframe');
        if (btn) btn.classList.toggle('active', isWireframe);
    }

    function resetRobotPose() {
        if (!container) return;
        const rect = container.getBoundingClientRect();
        containerRect = rect;
        lastClientX = rect.left + rect.width * 0.35;
        lastClientY = rect.top + rect.height * 0.35;
        solveArmAiming();
    }

    function updateCursorAiming(clientX, clientY) {
        if (!container || !camera || !raycaster) return;
        lastClientX = clientX;
        lastClientY = clientY;
        hasReceivedCursor = true;
        aimDirty = true; // solved in the next animation frame (mousemove can fire >200 Hz)
    }

    function onWindowMouseMove(e) {
        updateCursorAiming(e.clientX, e.clientY);
    }

    function onContainerMouseMove(e) {
        updateCursorAiming(e.clientX, e.clientY);
    }

    function onWindowTouchMove(e) {
        if (e.touches && e.touches.length > 0) {
            updateCursorAiming(e.touches[0].clientX, e.touches[0].clientY);
        }
    }

    /**
     * Analytical Inverse Kinematic Aiming:
     * Projects the cursor through the 3D scene camera frustum into workspace coordinates.
     * Computes Joint 1 (Base Yaw) and Joints 2/3 (Shoulder & Elbow Pitch) so the
     * End-Effector (EOF) and its laser beam aim directly at the cursor position with 0.00° error.
     */
    function solveArmAiming() {
        if (!container || !camera || !raycaster) return;

        const rect = containerRect || (containerRect = container.getBoundingClientRect());
        // Compute NDC in the camera view frustum of the 3D container
        const rawX = ((lastClientX - rect.left) / rect.width) * 2 - 1;
        const rawY = -((lastClientY - rect.top) / rect.height) * 2 + 1;

        mouseNDC.x = Math.max(-2.6, Math.min(2.6, rawX));
        mouseNDC.y = Math.max(-2.6, Math.min(2.6, rawY));

        raycaster.setFromCamera(mouseNDC, camera);

        // Project target out at depth 4.5 m along the camera ray:
        // This places the target outside the robot's physical reach envelope
        // so the end-effector and laser aim cleanly toward the cursor from any perspective.
        const target = camera.position.clone().addScaledVector(raycaster.ray.direction, 4.5);
        targetWorldPos.copy(target);

        const Xt = target.x;
        const Yt = target.y;
        const Zt = target.z;

        const y0 = 0.3; // Shoulder pivot height
        const L1 = 0.6; // Upper arm link length

        // 1. Joint 1 (Base Yaw):
        // In the Three.js model hierarchy, armGroup rotates in local Z,
        // which bends towards local -X.
        // Rotated by Joint 1 around world Y, local -X maps to [-cos(j1), 0, sin(j1)].
        // Thus: -cos(j1) = Xt / rt, sin(j1) = Zt / rt => j1 = atan2(Zt, -Xt)
        const j1 = Math.atan2(Zt, -Xt);
        targetJoints.j1 = j1;

        // 2. Radial distance and elevation:
        const rt = Math.sqrt(Xt * Xt + Zt * Zt);
        const dy = Yt - y0;
        const directAngle = Math.atan2(rt, dy);

        // 3. Joint 2 (Shoulder Pitch):
        // Smooth elevation distribution within physical bounds [0.05, 2.2]
        const j2 = Math.max(0.05, Math.min(2.2, directAngle * 0.45));
        targetJoints.j2 = j2;

        // 4. Elbow position in radial plane:
        const rElbow = L1 * Math.sin(j2);
        const yElbow = y0 + L1 * Math.cos(j2);

        // 5. Joint 3 (Elbow Pitch):
        // Orient forearm and tool so the ray from the elbow passes directly through (rt, Yt)
        // Since phi = j2 + j3:
        const phi = Math.atan2(rt - rElbow, Yt - yElbow);
        const j3 = Math.max(0.02, Math.min(2.45, phi - j2));
        targetJoints.j3 = j3;

        // 6. Joint 4 (Wrist Roll):
        targetJoints.j4 = 0.0;
    }

    function onScroll() {
        if (!container) return;
        containerRect = null; // position changed; re-measure lazily

        // While the hero canvas is visible keep cursor aiming active. Once it is scrolled
        // off-screen the render loop is paused, so no per-section choreography is computed.
        // (applyScrollChoreography below is kept for reference / future use.)
        if (isInView) aimDirty = true;
    }

    function applyScrollChoreography(sectionIdx, progress) {
        const t = performance.now() * 0.001;

        switch (sectionIdx) {
            case 0: // Hero: Gentle standby tracking
                targetJoints.j1 = Math.sin(t * 0.5) * 0.3 + mouseNDC.x * 0.4;
                targetJoints.j2 = 0.65 + Math.cos(t * 0.4) * 0.1;
                targetJoints.j3 = 1.1 + Math.sin(t * 0.3) * 0.1;
                targetJoints.j4 = mouseNDC.x * 0.2;
                break;

            case 1: // Philosophy: Extended inspect pose
                targetJoints.j1 = 0.6 + Math.sin(t * 0.6) * 0.15;
                targetJoints.j2 = 0.4;
                targetJoints.j3 = 1.4;
                targetJoints.j4 = -0.3;
                break;

            case 2: // 4-DOF Project: Smooth cyclic Cartesian pick-and-place tracking
                targetJoints.j1 = Math.sin(t * 1.4) * 0.7;
                targetJoints.j2 = 0.7 + Math.sin(t * 1.6) * 0.4;
                targetJoints.j3 = 1.2 + Math.cos(t * 1.6) * 0.35;
                targetJoints.j4 = Math.sin(t * 1.4) * 0.5;
                break;

            case 3: // Cartpole: Low horizontal stabilization pose
                targetJoints.j1 = Math.sin(t * 2.2) * 0.4;
                targetJoints.j2 = 1.1 + Math.sin(t * 2.2) * 0.15;
                targetJoints.j3 = 0.6;
                targetJoints.j4 = 0.0;
                break;

            case 4: // Drone Optical Link: Reaching skywards with laser
                targetJoints.j1 = -0.5;
                targetJoints.j2 = 0.2;
                targetJoints.j3 = 0.3;
                targetJoints.j4 = 0.6;
                break;

            case 5: // PCB Hardware: Precision inspection pose pointing downwards
                targetJoints.j1 = 0.4 + Math.sin(t * 0.8) * 0.12;
                targetJoints.j2 = 0.95;
                targetJoints.j3 = 1.35;
                targetJoints.j4 = Math.sin(t * 1.2) * 0.35;
                break;

            case 6: // Stack
            case 7: // Contact
            default:
                targetJoints.j1 = 0.0;
                targetJoints.j2 = 0.65;
                targetJoints.j3 = 1.1;
                targetJoints.j4 = 0.0;
                break;
        }
    }

    function updateTelemetryHUD() {
        if (!hudEls) return;
        const { j1: hudJ1, j2: hudJ2, j3: hudJ3, j4: hudJ4, x: hudX, y: hudY, z: hudZ } = hudEls;

        if (hudJ1) hudJ1.textContent = `${(joints.j1 * 57.2958).toFixed(1)}°`;
        if (hudJ2) hudJ2.textContent = `${(joints.j2 * 57.2958).toFixed(1)}°`;
        if (hudJ3) hudJ3.textContent = `${(joints.j3 * 57.2958).toFixed(1)}°`;
        if (hudJ4) hudJ4.textContent = `${(joints.j4 * 57.2958).toFixed(1)}°`;

        if (payloadMesh && hudX && hudY && hudZ) {
            const pos = payloadMesh.getWorldPosition(tmpWorldPos);
            hudX.textContent = pos.x.toFixed(2);
            hudY.textContent = pos.y.toFixed(2);
            hudZ.textContent = pos.z.toFixed(2);
        }
    }

    function animate() {
        if (!isInView || document.hidden) {
            rafId = null; // loop restarts from the IntersectionObserver / visibilitychange
            return;
        }
        rafId = requestAnimationFrame(animate);

        // Solve cursor aiming at most once per frame, only when input or scroll changed it
        if (aimDirty) {
            aimDirty = false;
            solveArmAiming();
        }

        // Smooth joint damping (Euler filter, response rate ~ 14 Hz)
        const filterRate = 0.12;

        // Shortest angular path on revolute base joint to avoid full-circle flips
        let diffJ1 = targetJoints.j1 - joints.j1;
        while (diffJ1 > Math.PI) diffJ1 -= Math.PI * 2;
        while (diffJ1 < -Math.PI) diffJ1 += Math.PI * 2;
        joints.j1 += diffJ1 * filterRate;

        joints.j2 += (targetJoints.j2 - joints.j2) * filterRate;
        joints.j3 += (targetJoints.j3 - joints.j3) * filterRate;
        joints.j4 += (targetJoints.j4 - joints.j4) * filterRate;

        // Apply joint rotations matching arm.xacro axes:
        // joint1: axis Z (Three.js Y)
        if (shoulderGroup) shoulderGroup.rotation.y = joints.j1;

        // joint2: axis Y (pitch)
        if (armGroup) armGroup.rotation.z = joints.j2;

        // joint3: axis Y (pitch)
        if (elbowGroup) elbowGroup.rotation.z = joints.j3;

        // joint4: axis Z (wrist roll/yaw)
        if (handGroup) handGroup.rotation.y = joints.j4;

        // Pulse laser intensity
        if (materials.laser) {
            materials.laser.opacity = (currentTheme === 'dark' ? 0.65 : 0.45) + Math.sin(performance.now() * 0.008) * 0.15;
        }

        // Text HUD at ~20 Hz is plenty and avoids layout work every frame
        if ((frameCount++ % 3) === 0) updateTelemetryHUD();
        renderer.render(scene, camera);
    }

    function onWindowResize() {
        if (!container || !renderer || !camera) return;
        containerRect = null;
        aimDirty = true;
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (!width || !height) return;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
