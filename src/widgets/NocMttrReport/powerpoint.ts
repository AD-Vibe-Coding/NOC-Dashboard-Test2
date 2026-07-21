import PptxGenJS from "pptxgenjs";
import { toBlob, toPng } from "html-to-image";
import { downloadBlob } from "../../lib/download";

export interface MttrPptChartTarget {
  title: string;
  subtitle?: string;
  element: HTMLElement | null;
}

export interface MttrPptContext {
  reportName: string;
  customerName: string;
  generatedBy: string;
  generatedAt: Date;
  selectedSheetName?: string | null;
  filtersSummary: string[];
  charts: MttrPptChartTarget[];
  thankYouLine?: string;
}

const BRAND = {
  white: "FFFFFF",
};

const LAYOUT = "LAYOUT_WIDE";
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

function imageSizingFill(dataUrl: string, x: number, y: number, w: number, h: number) {
  return { data: dataUrl, x, y, w, h };
}

function getCaptureDimensions(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || element.offsetWidth || 1600));
  const height = Math.max(1, Math.round(rect.height || element.offsetHeight || 900));

  return { width, height };
}

function buildCaptureOptions(element: HTMLElement) {
  const { width, height } = getCaptureDimensions(element);

  return {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: "#ffffff",
    skipFonts: false,
    width,
    height,
    canvasWidth: width * 2,
    canvasHeight: height * 2,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      maxWidth: `${width}px`,
      minWidth: `${width}px`,
      maxHeight: `${height}px`,
      minHeight: `${height}px`,
      margin: "0",
      inset: "auto",
      transform: "none",
      boxSizing: "border-box",
    },
  };
}

async function captureElement(element: HTMLElement): Promise<string> {
  return await toPng(element, buildCaptureOptions(element));
}

export async function copyElementImageToClipboard(element: HTMLElement, filename: string) {
  const blob = await toBlob(element, buildCaptureOptions(element));

  if (!blob) {
    throw new Error("Failed to capture panel image.");
  }

  if (typeof window === "undefined" || !("ClipboardItem" in window) || !navigator.clipboard?.write) {
    downloadBlob(blob, filename);
    return { copied: false, downloaded: true };
  }

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type || "image/png"]: blob,
      }),
    ]);
    return { copied: true, downloaded: false };
  } catch {
    downloadBlob(blob, filename);
    return { copied: false, downloaded: true };
  }
}

function sanitizeFilenamePart(value: string) {
  return value
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "report";
}

export async function exportNocMttrPowerPoint(context: MttrPptContext) {
  const pptx = new PptxGenJS();
  pptx.layout = LAYOUT;
  pptx.author = context.generatedBy;
  pptx.company = "vCom";
  pptx.subject = `NOC MTTR report for ${context.customerName}`;
  pptx.title = `NOC MTTR Report - ${context.customerName}`;
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
  };

  const chartTargets = context.charts.filter((chart) => chart.element);
  const capturedCharts = await Promise.all(
    chartTargets.map(async (chart) => {
      const rootElement = chart.element as HTMLElement;
      const captureTarget = (rootElement.querySelector('[data-copy-root="true"]') as HTMLElement | null) ?? rootElement;

      return {
        ...chart,
        imageData: await captureElement(captureTarget),
      };
    }),
  );

  for (const chart of capturedCharts) {
    const slide = pptx.addSlide();
    slide.background = { color: BRAND.white };
    slide.addImage(imageSizingFill(chart.imageData, 0, 0, SLIDE_W, SLIDE_H));
  }

  const blob = (await pptx.write({ outputType: "blob" })) as Blob;
  const filename = `noc-mttr-${sanitizeFilenamePart(context.customerName)}-${sanitizeFilenamePart(context.reportName)}.pptx`;
  downloadBlob(blob, filename);
}
