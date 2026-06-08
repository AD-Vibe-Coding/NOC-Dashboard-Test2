import fs from "fs";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const outputDir = path.resolve("public/management-docs");
const imgPath = path.resolve("user-uploads/image.png");
const DOC_VERSION = "v2";
const DOC_DATE = "June 5, 2026";
fs.mkdirSync(outputDir, { recursive: true });

async function makePdf({ filename, title, subtitle, sections, includeImage = true }) {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([612, 792]);
  const { width, height } = page.getSize();
  const margin = 36;
  let y = height - margin;

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  function ensureSpace(min = 24) {
    if (y < margin + min) {
      page = pdfDoc.addPage([612, 792]);
      y = 792 - margin;
    }
  }

  function drawText(text, opts = {}) {
    const size = opts.size ?? 10;
    const lh = opts.lh ?? size + 4;
    const x = opts.x ?? margin;
    const maxWidth = opts.maxWidth ?? width - margin * 2;
    const useFont = opts.bold ? bold : font;
    const color = opts.color ?? rgb(0.06, 0.1, 0.16);

    const words = String(text).split(" ");
    let line = "";
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
      ensureSpace(lh + 4);
      page.drawText(ln, { x, y, size, font: useFont, color });
      y -= lh;
    }
  }

  function section(titleText, bullets) {
    drawText(titleText, { bold: true, size: 12, lh: 16 });
    y -= 2;
    for (const b of bullets) {
      drawText(`• ${b}`, { size: 10, lh: 14, x: margin + 6, maxWidth: width - margin * 2 - 6 });
    }
    y -= 8;
  }

  drawText(title, { bold: true, size: 18, lh: 22 });
  drawText(subtitle, { size: 9, lh: 13, color: rgb(0.2, 0.25, 0.3) });
  drawText(`Document version: ${DOC_VERSION} | Generated: ${DOC_DATE}`, { size: 9, lh: 13, color: rgb(0.2, 0.25, 0.3) });
  y -= 8;

  for (const s of sections) section(s.title, s.bullets);

  if (includeImage && fs.existsSync(imgPath)) {
    drawText("Current Widget Snapshot", { bold: true, size: 12, lh: 16 });
    const imgBytes = fs.readFileSync(imgPath);
    const png = await pdfDoc.embedPng(imgBytes);
    const maxW = width - margin * 2;
    const maxH = 210;
    const scale = Math.min(maxW / png.width, maxH / png.height);
    const iw = png.width * scale;
    const ih = png.height * scale;
    ensureSpace(ih + 24);
    page.drawImage(png, { x: margin, y: y - ih, width: iw, height: ih });
    y -= ih + 12;
    drawText("Screenshot: Team Availability widget", { size: 9, lh: 12, color: rgb(0.2, 0.25, 0.3) });
  }

  const outPath = path.join(outputDir, filename);
  fs.writeFileSync(outPath, await pdfDoc.save());
  console.log(`Generated: ${outPath}`);
}

await makePdf({
  filename: "team-availability-overview-1-page.pdf",
  title: "Team Availability Widget — 1-Page Overview",
  subtitle: "Audience: Management | Purpose: Executive snapshot",
  sections: [
    { title: "What it is", bullets: [
      "A real-time operations panel for queue readiness, break/meeting context, and attendance signaling.",
      "Consolidates manual chat, spreadsheet, and ad-hoc follow-up workflows into one place.",
    ]},
    { title: "Core scope (full widget)", bullets: [
      "Queue availability metrics, role-based status controls, break tracking, and reminder governance.",
      "Punch in/out is one component within a broader daily operations control surface.",
    ]},
    { title: "Benefits for Team Members", bullets: [
      "Clear personal status and break visibility with less manual coordination overhead.",
      "Faster communication and fewer context switches across tools.",
    ]},
    { title: "Benefits for Management", bullets: [
      "Live queue coverage visibility and faster intervention on staffing gaps.",
      "Better governance with standardized events and action history.",
    ]},
  ],
});

await makePdf({
  filename: "team-availability-overview-executive-short.pdf",
  title: "Team Availability Widget — Executive Short Brief",
  subtitle: "Audience: Senior leadership | Read time: ~2 minutes",
  sections: [
    { title: "Problem", bullets: [
      "Manual attendance and queue checks are inconsistent and consume manager time.",
      "Operational risk appears late when updates depend on chat/manual tracking.",
    ]},
    { title: "Solution", bullets: [
      "Single widget with live in-shift/in-queue visibility and compact punch actions.",
      "Built-in reminder controls for planned meeting windows.",
    ]},
    { title: "Business value", bullets: [
      "Faster reaction to under-coverage before SLA impact.",
      "Reduced follow-up overhead and improved team accountability.",
      "Cleaner operational reporting posture through structured logs.",
    ]},
  ],
});

await makePdf({
  filename: "team-availability-overview-detailed.pdf",
  title: "Team Availability Widget — Detailed Management Overview",
  subtitle: "Audience: Operations management | Read time: ~6–8 minutes",
  sections: [
    { title: "Capability Summary", bullets: [
      "Queue availability metrics by overall view and queue-specific segments.",
      "Break and meeting status visibility for context-aware workforce balancing.",
      "Punch in/out actions with optional message prompts and Slack posting.",
      "Reminder controls including temporary pause during team-wide off-queue periods.",
    ]},
    { title: "Operational Advantages", bullets: [
      "Improves shift-level transparency in real time.",
      "Reduces reaction latency to queue deficits.",
      "Standardizes operational communication and event records.",
      "Supports coaching and trend reviews with cleaner data points.",
    ]},
    { title: "Team Experience Advantages", bullets: [
      "Lower friction for routine status updates.",
      "Clear ownership for individual availability signals.",
      "Less interruption from repetitive manual coordination.",
    ]},
    { title: "Traditional vs Widget-driven", bullets: [
      "Traditional: scattered updates, delayed visibility, and manager-heavy follow-up.",
      "Widget-driven: centralized actions, immediate visibility, and better accountability.",
      "Outcome: stronger operational consistency with lower manual overhead.",
    ]},
    { title: "Recommended Usage", bullets: [
      "Use as daily operational control plane during shifts.",
      "Use reminder pause during planned all-hands/team meeting windows.",
      "Review summary metrics in weekly management cadence.",
    ]},
  ],
});
