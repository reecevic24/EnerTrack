'use strict';

const PDFDocument = require('pdfkit');

async function buildAuditPdf(audit, reportText, photos = []) {
    const document = new PDFDocument({ size: 'A4', margin: 48, autoFirstPage: true });
    const chunks = [];
    document.on('data', chunk => chunks.push(chunk));

    document.fontSize(18).fillColor('#14532d').text('ENERTRACK | ENERGY AUDIT REPORT');
    document.moveDown();
    document.fontSize(10).fillColor('#111827');
    for (const line of reportText.split(/\r?\n/)) {
        if (/^\d+\. /.test(line)) {
            document.moveDown(0.5).fontSize(13).fillColor('#14532d').text(line);
            document.fontSize(10).fillColor('#111827');
        } else {
            document.text(line || ' ', { lineGap: 2 });
        }
        if (document.y > 720) document.addPage();
    }

    if (photos.length) {
        document.addPage().fontSize(15).fillColor('#14532d').text('APPENDIX: AUDIT PHOTOGRAPHS');
        document.moveDown();
        for (const photo of photos) {
            if (document.y > 630) document.addPage();
            document.fontSize(10).fillColor('#111827').text(photo.original_name);
            if (photo.mime_type !== 'image/webp') {
                try {
                    document.image(photo.image_data, { fit: [460, 300], align: 'center' });
                } catch (error) {
                    document.fontSize(9).fillColor('#64748b').text('Photo could not be embedded in the PDF.');
                }
            } else {
                document.fontSize(9).fillColor('#64748b').text('WebP photo is available in the online audit record.');
            }
            document.moveDown();
        }
    }

    return new Promise((resolve, reject) => {
        document.once('error', reject);
        document.once('end', () => resolve(Buffer.concat(chunks)));
        document.end();
    });
}

module.exports = { buildAuditPdf };
