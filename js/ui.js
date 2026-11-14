function init3DLogos() {
    const container = document.getElementById('header3DLogo');
    if (!container) return;
    container.innerHTML = '';
    if (typeof THREE === 'undefined') {
        container.textContent = '⚡';
        console.warn('Three.js is unavailable; using the text logo fallback.');
        return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.z = 3.2;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(32, 32);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const shape = new THREE.Shape();
    shape.moveTo(-0.1, 0.9);
    shape.lineTo(-0.7, 0.0);
    shape.lineTo(-0.15, 0.0);
    shape.lineTo(-0.45, -0.9);
    shape.lineTo(0.7, 0.1);
    shape.lineTo(0.15, 0.1);
    shape.lineTo(0.45, 0.9);
    shape.closePath();

    const extrudeSettings = { steps: 1, depth: 0.25, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3 };
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.center();

    const material = new THREE.MeshPhongMaterial({ color: 0xffbb00, emissive: 0x443000, specular: 0xffffff, shininess: 100 });
    const boltMesh = new THREE.Mesh(geometry, material);
    scene.add(boltMesh);

    const ringGeo = new THREE.TorusGeometry(1.0, 0.04, 16, 60);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x04e617 });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI / 3;
    scene.add(ringMesh);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    const pointLight = new THREE.PointLight(0xffffff, 1.2);
    pointLight.position.set(2, 3, 4);
    scene.add(pointLight);

    function animate() {
        requestAnimationFrame(animate);
        boltMesh.rotation.y += 0.025;
        ringMesh.rotation.z -= 0.015;
        renderer.render(scene, camera);
    }
    animate();
}

function handlePrintReport() {
    updateFacilityLabels();
    const authorInput = document.getElementById('authorName').value.trim();
    if(authorInput) {
        document.getElementById('printHeaderUserName').textContent = authorInput;
    } else if (currentUser && currentUser.name) {
        document.getElementById('printHeaderUserName').textContent = currentUser.name;
    }
    if (currentUser && currentUser.role === 'admin') {
        window.addEventListener('afterprint', () => {
            document.body.classList.remove('admin-print-report');
        }, { once: true });
        document.body.classList.add('admin-print-report');
    }
    window.print();
}

async function downloadUniversityBreakdown() {
    updateUniversitySummary();
    const canvas = document.getElementById('universityChart');
    const printHeaderUserLabel = document.getElementById('printHeaderUserLabel');
    const printHeaderUserName = document.getElementById('printHeaderUserName');
    const previousPrintHeaderUserLabel = printHeaderUserLabel.textContent;
    const previousPrintHeaderUserName = printHeaderUserName.textContent;
    let printImage = null;
    if (canvas && universityChartInstance) {
        try {
            universityChartInstance.resize();
            universityChartInstance.update('none');
            printImage = document.createElement('img');
            printImage.className = 'university-chart-print-image';
            printImage.alt = 'Monthly energy consumption by facility';
            printImage.src = canvas.toDataURL('image/png');
            canvas.after(printImage);
            await printImage.decode();
        } catch (error) {
            if (printImage) printImage.remove();
            console.error('Unable to prepare the university chart for printing.', error);
            alert('The energy chart could not be prepared for the PDF. Please try again.');
            return;
        }
    }

    const cleanupPrintView = () => {
        if (printImage) printImage.remove();
        printHeaderUserLabel.textContent = previousPrintHeaderUserLabel;
        printHeaderUserName.textContent = previousPrintHeaderUserName;
        document.body.classList.remove('print-university-breakdown');
    };
    window.addEventListener('afterprint', cleanupPrintView, { once: true });
    printHeaderUserLabel.textContent = 'Date of print';
    printHeaderUserName.textContent = new Date().toLocaleDateString();
    document.body.classList.add('print-university-breakdown');
    requestAnimationFrame(() => window.print());
}

window.addEventListener('DOMContentLoaded', () => {
    init3DLogos();
    checkSession().catch(reportApiError);
});
