function renderLoadRecommendationBoxes() {
    const container = document.getElementById('auditorCommentsContainer');
    container.innerHTML = '';

    loadRecommendations.forEach((rec, index) => {
        const box = document.createElement('div');
        box.className = 'auditor-comment-box';
        box.id = `recBox_${rec.id}`;

        const isCustom = index >= 4;
        if (isCustom) {
            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'btn-remove-custom-box';
            deleteButton.textContent = '✕ Delete Category';
            deleteButton.addEventListener('click', () => removeCustomLoadBox(rec.id));
            box.appendChild(deleteButton);

            const categoryLabel = document.createElement('label');
            categoryLabel.textContent = 'Equipment category:';
            const categoryInput = document.createElement('input');
            categoryInput.type = 'text';
            categoryInput.className = 'load-type-input';
            categoryInput.value = rec.loadType;
            categoryInput.placeholder = 'Enter equipment category';
            categoryInput.addEventListener('input', () => updateLoadTypeName(rec.id, categoryInput.value));
            box.append(categoryLabel, categoryInput);
        } else {
            const categoryTitle = document.createElement('h5');
            categoryTitle.className = 'rec-category-title';
            categoryTitle.textContent = rec.loadType;
            box.appendChild(categoryTitle);
        }

        const recommendationLabel = document.createElement('label');

        const recommendationInput = document.createElement('textarea');
        recommendationInput.placeholder = `Write recommendations for ${rec.loadType}...`;
        recommendationInput.value = rec.text || '';
        recommendationInput.addEventListener('input', () => updateLoadText(rec.id, recommendationInput.value));
        const printText = document.createElement('div');
        printText.className = 'print-comment-text';
        printText.id = `printRec_${rec.id}`;
        printText.textContent = rec.text.trim() || 'No specific recommendations entered for this equipment category.';
        box.append(recommendationLabel, recommendationInput, printText);
        container.appendChild(box);
    });
    updateRecommendationSubmitSection();
}

function updateRecommendationSubmitSection() {
    const section = document.getElementById('recommendationSubmitSection');
    if (!section) return;
    section.hidden = !loadRecommendations.some(recommendation =>
        recommendation.text && recommendation.text.trim()
    );
}

function addCustomLoadBox() {
    const newId = 'custom_' + Date.now();
    loadRecommendations.push({
        id: newId,
        loadType: 'New equipment category',
        text: ''
    });
    saveAuditorComments();
    renderLoadRecommendationBoxes();
}

function removeCustomLoadBox(id) {
    loadRecommendations = loadRecommendations.filter(r => r.id !== id);
    saveAuditorComments();
    renderLoadRecommendationBoxes();
}

function updateLoadTypeName(id, val) {
    const item = loadRecommendations.find(r => r.id === id);
    if (item) {
        item.loadType = val;
        saveAuditorComments();
    }
}

function updateLoadText(id, val) {
    const item = loadRecommendations.find(r => r.id === id);
    if (item) {
        item.text = val;
        const printElem = document.getElementById(`printRec_${id}`);
        if (printElem) {
            printElem.textContent = val.trim() || 'No specific recommendations entered for this equipment category.';
        }
        saveAuditorComments();
        updateRecommendationSubmitSection();
    }
}

function saveAuditorComments() {
    if (!currentUser) return;
    persistUserData('recommendations', loadRecommendations);

    const indicator = document.getElementById('saveIndicator');
    if (indicator) {
        indicator.classList.add('visible');
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            indicator.classList.remove('visible');
        }, 1500);
    }
}

async function loadAuditorComments() {
    if (!currentUser) return;
    let storedRecommendations = null;
    try {
        const recommendationsResponse = await apiRequest('/api/recommendations');
        storedRecommendations = recommendationsResponse.recommendations;
    } catch (error) {
        reportApiError(error);
        throw error;
    }
    loadRecommendations = Array.isArray(storedRecommendations) && storedRecommendations.length
        ? storedRecommendations.map((recommendation, index) => ({
            id: typeof recommendation?.id === 'string' && recommendation.id ? recommendation.id : `custom_${index}`,
            loadType: typeof recommendation?.loadType === 'string' ? recommendation.loadType : 'New equipment category',
            text: typeof recommendation?.text === 'string' ? recommendation.text : ''
        }))
        : createDefaultRecommendations();
    const standardCategories = {
        lighting: 'Lighting',
        hvac: 'HVAC (Air conditioners, Refrigerators etc)',
        motors: 'Motors and Pumps',
        electronics: 'Electronics & IT Systems'
    };
    loadRecommendations.forEach(recommendation => {
        if (standardCategories[recommendation.id]) {
            recommendation.loadType = standardCategories[recommendation.id];
        }
    });
    try {
        const storedEquipment = localStorage.getItem(
            `enertrack_equipmentDetails_${normalizeEmail(currentUser.email)}`
        );
        equipmentDetails = normalizeEquipmentDetails(storedEquipment ? JSON.parse(storedEquipment) : null);
    } catch (error) {
        console.error('Unable to load equipment details.', error);
        alert('Saved equipment details could not be read. The equipment list will open empty.');
        equipmentDetails = { actual: [], recommended: [] };
    }
    renderLoadRecommendationBoxes();
    renderEquipmentDetails();
    if (!Array.isArray(storedRecommendations) || !storedRecommendations.length) {
        persistUserData('recommendations', loadRecommendations);
    }
}
