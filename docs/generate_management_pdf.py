from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle
from reportlab.lib.units import inch
from pathlib import Path

out_path = Path('docs/team-availability-widget-management-overview.pdf')
img_path = Path('user-uploads/image.png')

doc = SimpleDocTemplate(str(out_path), pagesize=LETTER, rightMargin=36, leftMargin=36, topMargin=36, bottomMargin=36)
styles = getSampleStyleSheet()

h1 = ParagraphStyle('H1', parent=styles['Heading1'], fontSize=18, leading=22, spaceAfter=10)
h2 = ParagraphStyle('H2', parent=styles['Heading2'], fontSize=12, leading=15, spaceAfter=6, textColor=colors.HexColor('#0f172a'))
body = ParagraphStyle('Body', parent=styles['BodyText'], fontSize=10, leading=14, spaceAfter=6)
small = ParagraphStyle('Small', parent=styles['BodyText'], fontSize=9, leading=12, textColor=colors.HexColor('#334155'))

story = []
story.append(Paragraph('Team Availability Widget — Management Overview', h1))
story.append(Paragraph('Application: NOC Dashboard | Audience: Leadership / Management', small))
story.append(Spacer(1, 8))

story.append(Paragraph('1) Executive Summary', h2))
story.append(Paragraph('The Team Availability Widget provides a real-time operational view of queue readiness, status context, and attendance signaling (Punch In / Punch Out) in a single panel. It replaces fragmented manual coordination with a standardized and auditable workflow.', body))

story.append(Paragraph('2) Core Capabilities', h2))
for b in [
    'Live queue coverage visibility (in-shift vs. in-queue).',
    'Break / meeting status context for operational decision-making.',
    'Compact Punch In / Punch Out actions with message prompt and Slack posting.',
    'Backend event logging for attendance and delivery traceability.',
    'Manager controls to reduce reminder noise during planned meetings.'
]:
    story.append(Paragraph(f'• {b}', body))

story.append(Paragraph('3) Advantages for Team Members', h2))
for b in [
    'Less manual status reporting and lower context switching.',
    'Faster team communication using in-flow punch actions.',
    'Clear, timestamped activity history for accountability.'
]:
    story.append(Paragraph(f'• {b}', body))

story.append(Paragraph('4) Advantages for Management', h2))
for b in [
    'Immediate awareness of staffing and queue risk.',
    'Faster intervention before service-level impact.',
    'Centralized audit trail instead of scattered chat evidence.',
    'Lower supervisory overhead from manual follow-up.'
]:
    story.append(Paragraph(f'• {b}', body))

story.append(Paragraph('5) Comparison vs. Traditional Tracking', h2))
rows = [
    ['Area', 'Traditional', 'Widget-Based'],
    ['Queue visibility', 'Periodic/manual', 'Live & continuous'],
    ['Attendance signaling', 'Ad-hoc chat updates', 'Structured punch actions + Slack'],
    ['Auditability', 'Partial / fragmented', 'Centralized backend logs'],
    ['Manager effort', 'High manual follow-up', 'System-assisted visibility'],
]
t = Table(rows, colWidths=[1.4*inch, 2.2*inch, 2.8*inch])
t.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#e2e8f0')),
    ('TEXTCOLOR', (0,0), (-1,0), colors.HexColor('#0f172a')),
    ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#cbd5e1')),
    ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
    ('FONTSIZE', (0,0), (-1,-1), 9),
    ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ('LEFTPADDING', (0,0), (-1,-1), 6),
    ('RIGHTPADDING', (0,0), (-1,-1), 6),
]))
story.append(t)
story.append(Spacer(1, 10))

story.append(Paragraph('6) Product Snapshot', h2))
if img_path.exists():
    img = Image(str(img_path))
    img._restrictSize(6.8*inch, 3.6*inch)
    story.append(img)
    story.append(Paragraph('Screenshot: Team Availability widget (current build).', small))
else:
    story.append(Paragraph('No screenshot image found in user-uploads.', body))

story.append(Spacer(1, 8))
story.append(Paragraph('Recommendation: Continue using this widget as the primary team-operations surface for real-time queue readiness and attendance communication.', body))

doc.build(story)
print(f'Generated: {out_path}')
