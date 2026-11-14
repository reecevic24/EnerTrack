'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repositoryRoot = path.resolve(__dirname, '..');

class MockElement {
    constructor(tagName) {
        this.tagName = tagName;
        this.children = [];
        this.dataset = {};
        this.style = {};
        this.attributes = {};
        this._textContent = '';
        this._innerHTML = '';
    }

    set textContent(value) {
        this._textContent = String(value);
        this.children = [];
    }

    get textContent() {
        return this._textContent + this.children.map(child => child.textContent).join('');
    }

    set innerHTML(value) {
        this._innerHTML = value;
        this.children = [];
        this._textContent = '';
    }

    get innerHTML() {
        return this._innerHTML;
    }

    append(...elements) {
        this.children.push(...elements);
    }

    appendChild(element) {
        this.children.push(element);
        return element;
    }

    addEventListener() {}

    querySelector(selector) {
        if (selector === 'input') {
            return this.children.find(child => child.tagName === 'input') || null;
        }
        return null;
    }
}

function collectReviewContent(element) {
    return [
        element.textContent,
        element.value || '',
        ...element.children.map(collectReviewContent)
    ].join(' ');
}

test('pending audit review omits floor area, building type, and audit findings', () => {
    const queue = new MockElement('div');
    const context = {
        document: {
            getElementById(id) {
                return id === 'adminReviewQueue' ? queue : null;
            },
            createElement(tagName) {
                return new MockElement(tagName);
            }
        },
        facilityNames: ['Library'],
        sharedSubmissions: [{
            id: 'pending-audit',
            status: 'pending',
            submittedAt: '2026-11-14T10:00:00Z',
            auditorName: 'Test Auditor',
            auditorEmail: 'auditor@example.com',
            facilityId: 'Library',
            hostelName: '',
            facilityInfo: {
                facilityLocation: 'Main Campus',
                floorArea: '98765',
                authorName: 'Test Auditor',
                buildingType: 'Hidden Building Type',
                energySources: 'Grid electricity',
                auditDate: '2026-11-14'
            },
            findings: 'Hidden Audit Finding',
            historicalData: [],
            recommendations: ['Replace old lighting'],
            photos: [],
            inventory: []
        }],
        isAdministrator: () => true,
        currentAuditLabel: () => 'Library'
    };
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(repositoryRoot, 'js/admin-review.js'), 'utf8'),
        context,
        { filename: 'js/admin-review.js' }
    );

    vm.runInContext("activeAuditView = 'pending'; renderAdminReviewQueue();", context);

    const content = collectReviewContent(queue);
    assert.doesNotMatch(content, /Floor area|98765|Building type|Hidden Building Type|Audit findings|Hidden Audit Finding/);
    assert.match(content, /Energy sources/);
    assert.match(content, /Replace old lighting/);
});

test('audit status list excludes drafts but retains approved audits', () => {
    const queue = new MockElement('div');
    const context = {
        document: {
            getElementById(id) {
                return id === 'adminReviewQueue' ? queue : null;
            },
            createElement(tagName) {
                return new MockElement(tagName);
            }
        },
        sharedSubmissions: [
            { id: 'draft-audit', status: 'draft', facilityId: 'Draft Facility', auditorName: 'Draft Auditor' },
            { id: 'approved-audit', status: 'approved', facilityId: 'Approved Facility', auditorName: 'Approved Auditor' }
        ],
        isAdministrator: () => true,
        currentAuditLabel: submission => submission.facilityId
    };
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(repositoryRoot, 'js/admin-review.js'), 'utf8'),
        context,
        { filename: 'js/admin-review.js' }
    );

    vm.runInContext("activeAuditView = 'status'; renderAdminReviewQueue();", context);

    assert.match(queue.textContent, /Approved Facility · APPROVED/);
    assert.doesNotMatch(queue.textContent, /Draft Facility|DRAFT/);
});
