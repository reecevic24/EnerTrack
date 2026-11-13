function formatBillingMonth(month) {
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    if (!match) return month;
    const monthNumber = Number(match[2]);
    if (monthNumber < 1 || monthNumber > 12) return month;
    const monthName = new Date(Number(match[1]), Number(match[2]) - 1, 1)
        .toLocaleString('en-US', { month: 'short' });
    return `${match[1]}-${monthName}`;
}

function renderHistoricalData(entries) {
    const body = document.getElementById('historyBody');
    if (!body) return;
    body.innerHTML = '';
    if (!entries.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = isAdministrator() ? 3 : 4;
        cell.className = 'empty-state';
        cell.textContent = 'No historical bill data entered.';
        row.appendChild(cell);
        body.appendChild(row);
        return;
    }
    entries.slice().sort((a, b) => a.month.localeCompare(b.month)).forEach((entry, index) => {
        const row = document.createElement('tr');
        [formatBillingMonth(entry.month), Number(entry.kwh).toLocaleString('en-US'), `KES ${Number(entry.cost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`].forEach(value => {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.appendChild(cell);
        });
        const action = document.createElement('td');
        if (!isAdministrator()) {
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'btn-delete';
            remove.textContent = 'Remove';
            remove.addEventListener('click', () => {
                historicalData.splice(index, 1);
                renderHistoricalData(historicalData);
                persistCurrentAuditEvidence();
            });
            action.appendChild(remove);
            row.appendChild(action);
        }
        body.appendChild(row);
    });
}

function addHistoricalEntry() {
    if (isAdministrator()) return;
    const month = document.getElementById('historyMonth').value;
    const kwh = Number(document.getElementById('historyKwh').value);
    const cost = Number(document.getElementById('historyCost').value);
    if (!month || !Number.isFinite(kwh) || kwh < 0 || !Number.isFinite(cost) || cost < 0) {
        alert('Enter a billing month, non-negative consumption, and non-negative bill amount.');
        return;
    }
    const existing = historicalData.findIndex(entry => entry.month === month);
    const entry = { month, kwh, cost };
    if (existing >= 0) historicalData[existing] = entry;
    else historicalData.push(entry);
    document.getElementById('historyMonth').value = '';
    document.getElementById('historyKwh').value = '';
    document.getElementById('historyCost').value = '';
    renderHistoricalData(historicalData);
    persistCurrentAuditEvidence();
}

function renderAuditPhotos(photos) {
    const gallery = document.getElementById('auditPhotoGallery');
    if (!gallery) return;
    gallery.innerHTML = '';
    photos.forEach((photo, index) => {
        const figure = document.createElement('figure');
        figure.className = 'audit-photo-card';
        const image = document.createElement('img');
        if (photo.dataUrl && !photo.dataUrl.startsWith('data:')) image.crossOrigin = 'use-credentials';
        image.src = photo.dataUrl;
        image.alt = photo.name || `Audit photo ${index + 1}`;
        const caption = document.createElement('figcaption');
        caption.textContent = photo.name || `Audit photo ${index + 1}`;
        figure.append(image, caption);
        if (!isAdministrator()) {
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'btn-delete';
            remove.textContent = 'Remove photo';
            remove.addEventListener('click', () => {
                auditPhotos.splice(index, 1);
                renderAuditPhotos(auditPhotos);
                persistCurrentAuditEvidence();
            });
            figure.appendChild(remove);
        }
        gallery.appendChild(figure);
    });
}

function resizeAuditPhoto(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error(`Unable to read photo "${file.name}".`));
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => reject(new Error(`Photo "${file.name}" is not a readable image.`));
            image.onload = () => {
                const maxDimension = 1280;
                const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve({
                    name: file.name,
                    dataUrl: canvas.toDataURL('image/jpeg', 0.78)
                });
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

async function handleAuditPhotos(files) {
    if (isAdministrator()) return;
    const selectedFiles = Array.from(files || []);
    if (!selectedFiles.length) return;
    if (selectedFiles.some(file => !file.type.startsWith('image/'))) {
        alert('Only image files can be added as audit photos.');
        document.getElementById('auditPhotos').value = '';
        return;
    }
    try {
        const resizedPhotos = await Promise.all(selectedFiles.map(resizeAuditPhoto));
        auditPhotos.push(...resizedPhotos);
        persistCurrentAuditEvidence();
        renderAuditPhotos(auditPhotos);
    } catch (error) {
        console.error('Unable to add audit photos.', error);
        alert(error.message || 'Unable to add the selected audit photos.');
    } finally {
        document.getElementById('auditPhotos').value = '';
    }
}
