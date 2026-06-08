import fs from 'fs';
import path from 'path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const outPath = path.resolve('docs/team-availability-widget-management-overview.pdf');
const imgPath = path.resolve('user-uploads/image.png');

const pdfDoc = await PDFDocument.create();
let page = pdfDoc.addPage([612, 792]); // Letter
const { width, height } = page.getSize();
const margin = 36;
let y = height - margin;

const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

function drawText(text, opts = {}) {
  const size = opts.size ?? 10;
  const lh = opts.lh ?? (size + 4);
  const x = opts.x ?? margin;
  const maxWidth = opts.maxWidth ?? (width - margin * 2);
  const useFont = opts.bold ? bold : font;
  const color = opts.color ?? rgb(0.06, 0.1, 0.16);

  const words = text.split(' ');
  let line = '';
  const lines = [];
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    const tw = useFont.widthOfTextAtSize(test, size);
    if (tw > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  for (const ln of lines) {
    if (y < margin + 20) {
      page = pdfDoc.addPage([612, 792]);
      y = 792 - margin;
    }
    page.drawText(ln, { x, y, size, font: useFont, color });
    y -= lh;
  }
}

function section(title, bullets) {
  drawText(title, { bold: true, size: 12, lh: 16 });
  y -= 2;
  for (const b of bullets) drawText(`• ${b}`, { size: 10, lh: 14, x: margin + 6, maxWidth: width - margin * 2 - 6 });
  y -= 6;
}

drawText('Team Availability Widget — Management Overview', { bold: true, size: 18, lh: 22 });
drawText('Application: NOC Dashboard  |  Audience: Leadership / Management', { size: 9, lh: 13, color: rgb(0.2,0.25,0.3) });
y -= 6;

section('Executive Summary', [
  'A real-time operations panel for queue readiness, status context, and attendance signaling.',
  'Centralizes workflow that was previously split across chat check-ins, spreadsheets, and manual follow-ups.',
]);

section('Core Capabilities', [
  'Live in-shift vs. in-queue visibility and queue coverage breakdown.',
  'Break and meeting status awareness for operational planning.',
  'Compact Punch In / Punch Out actions with message prompt and Slack posting.',
  'Backend event logging for attendance and delivery traceability.',
  'Manager reminder controls for planned meeting windows.',
]);

section('Advantages for Team Members', [
  'Less manual reporting and fewer context switches.',
  'Faster communication from the same operational screen.',
  'Consistent and timestamped action history.',
]);

section('Advantages for Management', [
  'Immediate awareness of staffing and queue risk.',
  'Faster intervention before service-level impact.',
  'Improved governance via centralized logs and standardized actions.',
  'Reduced manual follow-up overhead.',
]);

section('Compared to Traditional Tracking', [
  'Traditional: periodic/manual updates, fragmented records, heavy chat follow-up.',
  'Widget-based: live visibility, structured actions, and auditable backend events.',
]);

if (fs.existsSync(imgPath)) {
  drawText('Product Snapshot', { bold: true, size: 12, lh: 16 });
  const imgBytes = fs.readFileSync(imgPath);
  const png = await pdfDoc.embedPng(imgBytes);
  const maxW = width - margin * 2;
  const maxH = 230;
  const scale = Math.min(maxW / png.width, maxH / png.height);
  const iw = png.width * scale;
  const ih = png.height * scale;
  if (y - ih < margin) {
    page = pdfDoc.addPage([612, 792]);
    y = 792 - margin;
  }
  page.drawImage(png, { x: margin, y: y - ih, width: iw, height: ih });
  y -= ih + 14;
  drawText('Screenshot: Team Availability widget (current build).', { size: 9, lh: 12, color: rgb(0.2,0.25,0.3) });
}

drawText('Recommendation: Continue rollout as the primary daily operations surface for queue readiness and attendance signaling.', { size: 10, lh: 14 });

const bytes = await pdfDoc.save();
fs.writeFileSync(outPath, bytes);
console.log(`Generated: ${outPath}`);
