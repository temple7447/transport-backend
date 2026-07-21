const PDFDocument = require('pdfkit');

const C = {
  navy:   '#0D0840',
  navyLt: '#1A1560',
  amber:  '#F59E0B',
  red:    '#DC2626',
  green:  '#16A34A',
  white:  '#FFFFFF',
  light:  '#F8FAFC',
  border: '#E2E8F0',
  text:   '#1E293B',
  muted:  '#64748B',
  row:    '#F1F5F9',
};

const PW = 595.28; // A4 width pt
const PH = 841.89; // A4 height pt
const ML = 45;     // margin left
const MR = 45;     // margin right
const CW = PW - ML - MR; // content width

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Core helpers ────────────────────────────────────────────────────────────

function createDoc(res, filename) {
  const doc = new PDFDocument({ margin: 0, size: 'A4', bufferPages: true, autoFirstPage: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  return doc;
}

// Returns a Buffer — used for email attachments
function generateToBuffer(drawFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 0, size: 'A4', bufferPages: true, autoFirstPage: true });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawFn(doc);
  });
}

function drawHeader(doc, docTitle, docRef) {
  // Navy gradient-style header band
  doc.rect(0, 0, PW, 72).fill(C.navy);
  doc.rect(0, 72, PW, 6).fill(C.amber);

  // Brand name
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(20)
    .text('ACCESSIBLEXPRESS', ML, 18);
  doc.fillColor(C.amber).font('Helvetica').fontSize(8)
    .text('GLOBAL LOGISTICS & FREIGHT', ML, 42);

  // Document title (right-aligned)
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(15)
    .text(docTitle, 0, 18, { align: 'right', width: PW - MR });
  doc.fillColor(C.amber).font('Helvetica').fontSize(8)
    .text(docRef, 0, 42, { align: 'right', width: PW - MR });

  return 90; // y after header
}

function drawSectionBar(doc, y, title) {
  doc.rect(ML, y, CW, 18).fill(C.navy);
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(7.5)
    .text(title.toUpperCase(), ML + 8, y + 5.5, { width: CW - 16 });
  return y + 18;
}

function drawField(doc, x, y, w, label, value) {
  doc.fillColor(C.muted).font('Helvetica').fontSize(6.5)
    .text(label.toUpperCase(), x, y, { width: w });
  doc.fillColor(C.text).font('Helvetica-Bold').fontSize(9)
    .text(value || '—', x, y + 9, { width: w });
}

function drawDivider(doc, y) {
  doc.moveTo(ML, y).lineTo(PW - MR, y).strokeColor(C.border).lineWidth(0.5).stroke();
  return y + 1;
}

function drawFooters(doc, trackingNumber) {
  const count = doc.bufferedPageRange().count;
  for (let i = 0; i < count; i++) {
    doc.switchToPage(i);
    const fy = PH - 30;
    doc.rect(0, fy, PW, 30).fill(C.light);
    doc.moveTo(0, fy).lineTo(PW, fy).strokeColor(C.border).lineWidth(0.5).stroke();
    doc.fillColor(C.muted).font('Helvetica').fontSize(7)
      .text(
        `${trackingNumber}  •  Generated ${new Date().toUTCString()}  •  accessiblexpress.com`,
        ML, fy + 10
      );
    doc.fillColor(C.muted).font('Helvetica').fontSize(7)
      .text(`Page ${i + 1} of ${count}`, 0, fy + 10, { align: 'right', width: PW - MR });
  }
}

// ─── Party block (sender + recipient side by side) ───────────────────────────

function drawParties(doc, y, leftLabel, left, rightLabel, right) {
  const mid = ML + CW / 2;
  const colW = CW / 2 - 12;

  y = drawSectionBar(doc, y, `${leftLabel}  /  ${rightLabel}`);
  y += 8;

  const addr = (p) => [p.street, p.city, p.state, p.postalCode].filter(Boolean).join(', ');

  // Left column
  drawField(doc, ML + 8, y,      colW, 'Full Name',  left.name);
  drawField(doc, ML + 8, y + 30, colW, 'Address',    addr(left));
  drawField(doc, ML + 8, y + 60, colW / 2 - 4, 'Country', left.country);
  drawField(doc, ML + 8 + colW / 2, y + 60, colW / 2 - 4, 'Phone', left.phone);
  drawField(doc, ML + 8, y + 85, colW, 'Email', left.email);

  // Vertical divider
  doc.moveTo(mid, y - 4).lineTo(mid, y + 108)
    .strokeColor(C.border).lineWidth(0.5).stroke();

  // Right column
  drawField(doc, mid + 8, y,      colW, 'Full Name',  right.name);
  drawField(doc, mid + 8, y + 30, colW, 'Address',    addr(right));
  drawField(doc, mid + 8, y + 60, colW / 2 - 4, 'Country', right.country);
  drawField(doc, mid + 8 + colW / 2, y + 60, colW / 2 - 4, 'Phone', right.phone);
  drawField(doc, mid + 8, y + 85, colW, 'Email', right.email);

  // Bottom border
  const endY = y + 108;
  doc.rect(ML, y - 4, CW, endY - y + 8).strokeColor(C.border).lineWidth(0.5).stroke();

  return endY + 12;
}

// ─── AIR WAYBILL ─────────────────────────────────────────────────────────────

function drawAWB(doc, shipment) {
  let y = drawHeader(doc, 'AIR WAYBILL', 'NON-NEGOTIABLE COPY');

  // ── AWB number hero block ──
  doc.rect(ML, y, CW, 46).fill(C.light).strokeColor(C.border).lineWidth(0.5).stroke();
  doc.rect(ML, y, 4, 46).fill(C.amber);
  doc.fillColor(C.muted).font('Helvetica').fontSize(7)
    .text('AIR WAYBILL NUMBER', ML + 14, y + 8);
  doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(22)
    .text(shipment.trackingNumber, ML + 14, y + 18);

  // Status badge
  const statusLabel = (shipment.status || 'pending').replace(/_/g, ' ').toUpperCase();
  doc.rect(PW - MR - 90, y + 12, 82, 22).fill(C.navy);
  doc.fillColor(C.amber).font('Helvetica-Bold').fontSize(8)
    .text(statusLabel, PW - MR - 86, y + 18, { width: 74, align: 'center' });

  y += 58;

  // ── Parties ──
  y = drawParties(doc, y, 'Shipper', shipment.sender, 'Consignee', shipment.recipient);

  // ── Shipment details ──
  y = drawSectionBar(doc, y, 'Shipment Details');
  y += 8;
  const qw = CW / 4 - 4;
  drawField(doc, ML + 8,           y, qw, 'Service Type',     (shipment.service || '').replace(/_/g, ' ').toUpperCase());
  drawField(doc, ML + 8 + qw + 8,  y, qw, 'Gross Weight (kg)', String(shipment.weight));
  const dims = shipment.dimensions
    ? `${shipment.dimensions.length||'—'} × ${shipment.dimensions.width||'—'} × ${shipment.dimensions.height||'—'}`
    : '—';
  drawField(doc, ML + 8 + (qw + 8) * 2, y, qw, 'Dimensions (cm)', dims);
  drawField(doc, ML + 8 + (qw + 8) * 3, y, qw, 'Declared Value',
    shipment.declaredValue ? `$${fmtMoney(shipment.declaredValue)}` : '—');
  doc.rect(ML, y - 4, CW, 38).strokeColor(C.border).lineWidth(0.5).stroke();
  y += 42;

  // Contents
  y = drawSectionBar(doc, y, 'Description of Contents');
  y += 8;
  doc.fillColor(C.text).font('Helvetica').fontSize(9)
    .text(shipment.contents || 'General Cargo', ML + 8, y, { width: CW - 16 });
  doc.rect(ML, y - 4, CW, 28).strokeColor(C.border).lineWidth(0.5).stroke();
  y += 32;

  // ── Routing ──
  y = drawSectionBar(doc, y, 'Routing & Schedule');
  y += 8;
  const tw = CW / 3 - 6;
  drawField(doc, ML + 8,            y, tw, 'Origin',      `${shipment.sender.city||''}, ${shipment.sender.country||''}`);
  drawField(doc, ML + 8 + tw + 10,  y, tw, 'Destination', `${shipment.recipient.city||''}, ${shipment.recipient.country||''}`);
  drawField(doc, ML + 8 + (tw+10)*2, y, tw, 'Est. Delivery', shipment.eta ? new Date(shipment.eta).toDateString() : 'TBD');
  doc.rect(ML, y - 4, CW, 38).strokeColor(C.border).lineWidth(0.5).stroke();
  y += 46;

  drawField(doc, ML + 8, y, tw, 'Issue Date',    new Date(shipment.createdAt).toDateString());
  drawField(doc, ML + 8 + tw + 10, y, tw, 'Service Class', (shipment.service||'').replace(/_/g,' ').toUpperCase());
  y += 28;

  // ── Signature ──
  y = drawSectionBar(doc, y, 'Shipper Certification & Signature');
  y += 6;
  doc.rect(ML, y, CW, 52).fill(C.light).strokeColor(C.border).lineWidth(0.5).stroke();
  doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
    .text(
      'I hereby certify that the particulars on the face hereof are correct and that insofar as any part of the consignment contains dangerous goods, such part is properly described by name and is in proper condition for carriage by air according to applicable regulations.',
      ML + 10, y + 8, { width: CW - 20 }
    );
  doc.fillColor(C.muted).font('Helvetica').fontSize(7)
    .text('Signature & Date', ML + 10, y + 40);
  y += 60;

  drawFooters(doc, shipment.trackingNumber);
  doc.end();
}

exports.generateAWB = function (shipment, res) {
  const doc = createDoc(res, `AWB-${shipment.trackingNumber}.pdf`);
  drawAWB(doc, shipment);
};

// ─── COMMERCIAL INVOICE ───────────────────────────────────────────────────────

function drawInvoice(doc, shipment) {
  let y = drawHeader(doc, 'COMMERCIAL INVOICE', `INV-${shipment.trackingNumber}`);

  // ── Invoice meta ──
  doc.rect(ML, y, CW, 46).fill(C.light).strokeColor(C.border).lineWidth(0.5).stroke();
  doc.rect(ML, y, 4, 46).fill(C.amber);
  const mw = CW / 3 - 6;
  drawField(doc, ML + 14,           y + 8, mw, 'Invoice Number', `INV-${shipment.trackingNumber}`);
  drawField(doc, ML + 14 + mw + 10, y + 8, mw, 'Invoice Date',   new Date(shipment.createdAt).toDateString());
  drawField(doc, ML + 14 + (mw+10)*2, y + 8, mw, 'Currency',     'USD');
  y += 58;

  // ── Parties ──
  y = drawParties(doc, y, 'Exporter / Seller', shipment.sender, 'Importer / Buyer', shipment.recipient);

  // ── Line items table ──
  y = drawSectionBar(doc, y, 'Line Items');
  y += 2;

  // Table header row — HS Code/Qty stay narrow since their content is always
  // short ("—"/"1"), leaving enough room for Unit Value/Total to hold large
  // declared values (e.g. "$123,456,789.99") without wrapping to a 2nd line.
  const cols = [ML + 8, ML + 205, ML + 260, ML + 300, ML + 400];
  const hdrs = ['Description of Goods', 'HS Code', 'Qty', 'Unit Value (USD)', 'Total (USD)'];
  doc.rect(ML, y, CW, 20).fill(C.navyLt);
  hdrs.forEach((h, i) => {
    const w = i < hdrs.length - 1 ? cols[i+1] - cols[i] - 4 : ML + CW - cols[i] - 8;
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(7.5)
      .text(h, cols[i], y + 6, { width: w });
  });
  y += 20;

  // Data row
  const unitVal = shipment.declaredValue || 0;
  doc.rect(ML, y, CW, 24).fill(C.white).strokeColor(C.border).lineWidth(0.5).stroke();
  doc.fillColor(C.text).font('Helvetica').fontSize(8.5)
    .text(shipment.contents || 'General Cargo', cols[0], y + 7, { width: 190 });
  doc.text('—',                       cols[1], y + 7);
  doc.text('1',                        cols[2], y + 7);
  doc.text(`$${fmtMoney(unitVal)}`,    cols[3], y + 7, { width: cols[4] - cols[3] - 4 });
  doc.text(`$${fmtMoney(unitVal)}`,    cols[4], y + 7, { width: ML + CW - cols[4] - 8 });
  y += 24;

  // Total row
  doc.rect(ML, y, CW, 28).fill(C.navy).strokeColor(C.border).lineWidth(0.5).stroke();
  doc.fillColor(C.amber).font('Helvetica-Bold').fontSize(9)
    .text('TOTAL DECLARED VALUE', cols[0], y + 9);
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(13)
    .text(`USD $${fmtMoney(unitVal)}`, 0, y + 7, { align: 'right', width: PW - MR - 8 });
  y += 36;

  // ── Customs info ──
  y = drawSectionBar(doc, y, 'Shipment & Customs Information');
  y += 8;
  const cw3 = CW / 3 - 6;
  drawField(doc, ML + 8,              y, cw3, 'Country of Origin',      shipment.sender.country    || '—');
  drawField(doc, ML + 8 + cw3 + 10,  y, cw3, 'Country of Destination', shipment.recipient.country || '—');
  drawField(doc, ML + 8 + (cw3+10)*2, y, cw3, 'Incoterms',             'DAP');
  doc.rect(ML, y - 4, CW, 38).strokeColor(C.border).lineWidth(0.5).stroke();
  y += 46;

  drawField(doc, ML + 8,              y, cw3, 'Gross Weight (kg)',  String(shipment.weight));
  drawField(doc, ML + 8 + cw3 + 10,  y, cw3, 'Service',            (shipment.service||'').replace(/_/g,' ').toUpperCase());
  drawField(doc, ML + 8 + (cw3+10)*2, y, cw3, 'Tracking Number',   shipment.trackingNumber);
  y += 28;

  // ── Declaration ──
  y = drawSectionBar(doc, y, 'Declaration');
  y += 6;
  doc.rect(ML, y, CW, 52).fill(C.light).strokeColor(C.border).lineWidth(0.5).stroke();
  doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
    .text(
      'I declare that the information on this invoice is true and correct and that the contents and value of this shipment are as stated above. This shipment does not contain any undeclared dangerous or prohibited items.',
      ML + 10, y + 8, { width: CW - 20 }
    );
  doc.fillColor(C.muted).font('Helvetica').fontSize(7)
    .text('Authorised Signature & Company Stamp', ML + 10, y + 38);
  y += 60;

  drawFooters(doc, shipment.trackingNumber);
  doc.end();
}

exports.generateInvoice = function (shipment, res) {
  const doc = createDoc(res, `Invoice-${shipment.trackingNumber}.pdf`);
  drawInvoice(doc, shipment);
};

// ─── PACKING LIST ─────────────────────────────────────────────────────────────

function drawPackingList(doc, shipment) {
  let y = drawHeader(doc, 'PACKING LIST', `PKL-${shipment.trackingNumber}`);

  // ── Reference meta ──
  doc.rect(ML, y, CW, 46).fill(C.light).strokeColor(C.border).lineWidth(0.5).stroke();
  doc.rect(ML, y, 4, 46).fill(C.amber);
  const mw = CW / 3 - 6;
  drawField(doc, ML + 14,             y + 8, mw, 'Packing List Ref.',  `PKL-${shipment.trackingNumber}`);
  drawField(doc, ML + 14 + mw + 10,  y + 8, mw, 'Date Prepared',      new Date(shipment.createdAt).toDateString());
  drawField(doc, ML + 14 + (mw+10)*2, y + 8, mw, 'Status',
    (shipment.status||'').replace(/_/g,' ').toUpperCase());
  y += 58;

  // ── Parties ──
  y = drawParties(doc, y, 'Shipped From', shipment.sender, 'Ship To', shipment.recipient);

  // ── Package contents table ──
  y = drawSectionBar(doc, y, 'Package Contents');
  y += 2;

  const pcols = [ML + 8, ML + 155, ML + 265, ML + 310, ML + 375, ML + 450];
  const phdrs = ['Description', 'Contents', 'Qty', 'Weight (kg)', 'L × W × H (cm)', 'Condition'];
  doc.rect(ML, y, CW, 20).fill(C.navyLt);
  phdrs.forEach((h, i) => {
    const w = i < phdrs.length - 1 ? pcols[i+1] - pcols[i] - 4 : ML + CW - pcols[i] - 8;
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(7.5)
      .text(h, pcols[i], y + 6, { width: w });
  });
  y += 20;

  const dims = shipment.dimensions
    ? `${shipment.dimensions.length||'—'} × ${shipment.dimensions.width||'—'} × ${shipment.dimensions.height||'—'}`
    : '—';

  // Data row (alternating bg)
  doc.rect(ML, y, CW, 26).fill(C.row).strokeColor(C.border).lineWidth(0.5).stroke();
  doc.fillColor(C.text).font('Helvetica').fontSize(8.5)
    .text('Package 1',                   pcols[0], y + 8)
    .text(shipment.contents || 'General Cargo', pcols[1], y + 8, { width: 105 })
    .text('1',                            pcols[2], y + 8)
    .text(String(shipment.weight),        pcols[3], y + 8)
    .text(dims,                           pcols[4], y + 8)
    .text('Good',                         pcols[5], y + 8);
  y += 26;

  // Summary row
  doc.rect(ML, y, CW, 26).fill(C.navy).strokeColor(C.border).lineWidth(0.5).stroke();
  doc.fillColor(C.amber).font('Helvetica-Bold').fontSize(8.5)
    .text('TOTALS', pcols[0], y + 8);
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(8.5)
    .text('1 pkg',              pcols[2], y + 8)
    .text(`${shipment.weight} kg`, pcols[3], y + 8);
  y += 34;

  // ── Notes ──
  y = drawSectionBar(doc, y, 'Special Instructions & Notes');
  y += 6;
  const noteText = shipment.notes || 'No special instructions.';
  const noteLines = doc.heightOfString(noteText, { width: CW - 20, font: 'Helvetica', fontSize: 8.5 });
  const noteBoxH  = Math.max(40, noteLines + 20);
  doc.rect(ML, y, CW, noteBoxH).fill(C.light).strokeColor(C.border).lineWidth(0.5).stroke();
  doc.fillColor(C.text).font('Helvetica').fontSize(8.5)
    .text(noteText, ML + 10, y + 10, { width: CW - 20 });
  y += noteBoxH + 10;

  // ── Prepared by ──
  y = drawSectionBar(doc, y, 'Prepared By — Accessiblexpress');
  y += 8;
  const hw = CW / 2 - 6;
  drawField(doc, ML + 8,          y, hw, 'Company',  'Accessiblexpress Ltd.');
  drawField(doc, ML + 8 + hw + 10, y, hw, 'Website', 'accessiblexpress.com');
  y += 28;
  drawField(doc, ML + 8,          y, hw, 'Email',    'logistics@accessiblexpress.com');
  drawField(doc, ML + 8 + hw + 10, y, hw, 'Phone',   '+1 (800) AXP-SHIP');
  y += 8;

  drawFooters(doc, shipment.trackingNumber);
  doc.end();
}

exports.generatePackingList = function (shipment, res) {
  const doc = createDoc(res, `PackingList-${shipment.trackingNumber}.pdf`);
  drawPackingList(doc, shipment);
};

// ─── Generate all 3 docs as Buffers (for email attachments) ──────────────────

exports.generateAllToBuffers = async function (shipment) {
  const [awb, invoice, packingList] = await Promise.all([
    generateToBuffer((doc) => drawAWB(doc, shipment)),
    generateToBuffer((doc) => drawInvoice(doc, shipment)),
    generateToBuffer((doc) => drawPackingList(doc, shipment)),
  ]);
  return { awb, invoice, packingList };
};
