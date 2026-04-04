// ─── Dil avtomatik aşkarlanması ───────────────────────────────────────────
function detectLanguage(text) {
  const az = (text.match(/[əƏ]/g) || []).length;
  const ru = (text.match(/[а-яёА-ЯЁ]/g) || []).length;
  const tr = (text.match(/İ/g) || []).length;
  if (ru > 5) return 'ru';
  if (az > 2) return 'az';
  if (tr > 2) return 'tr';
  return 'en';
}

// ─── Format avtomatik aşkarlanması ───────────────────────────────────────
function detectFormat(text) {
  if (text.includes('<?xml') || text.includes('bpmn:') || text.includes('<definitions')) return 'camunda-xml';
  if (text.match(/@startuml|@enduml/)) return 'plantuml';
  if (text.match(/^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie)/m)) return 'mermaid';
  return 'auto';
}

const LANG_LABELS = {
  az: 'Azərbaycan',
  en: 'English',
  ru: 'Русский',
  tr: 'Türkçe'
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { uml, diagType, mode } = req.body;
  if (!uml) return res.status(400).json({ error: 'Content is required' });

  // Dil auto-detect
  const detectedLang = detectLanguage(uml);
  const langLabel = LANG_LABELS[detectedLang] || 'Azerbaijani';

  // Format auto-detect
  const fmt = detectFormat(uml);

  const diagLabel = {
    'use-case': 'Use Case Diagram',
    'sequence': 'Sequence Diagram',
    'class': 'Class Diagram',
    'activity': 'Activity Diagram',
    'bpmn': 'BPMN Process Diagram'
  }[diagType] || 'Activity Diagram';

  const fmtLabel = {
    'auto': 'auto-detected',
    'mermaid': 'Mermaid',
    'plantuml': 'PlantUML',
    'camunda-xml': 'Camunda BPMN XML'
  }[fmt] || 'auto-detected';

  const isBpmn = diagType === 'bpmn' || fmt === 'camunda-xml';
  const isDocument = mode === 'document';

  // ─── BPMN Preprocessing ──────────────────────────────────────────────────
  let processedContent = uml;
  if (!isDocument && isBpmn && uml.length > 12000) {
    const lines = uml.split('\n');
    processedContent = lines.filter(l => {
      const t = l.trim();
      if (!t) return false;
      if (t.match(/BPMNEdge|BPMNShape|waypoint|dc:Bounds|di:waypoint|bpmndi:/)) return false;
      return true;
    }).join('\n');
    if (processedContent.length > 12000) {
      const diIdx = processedContent.indexOf('<bpmndi:BPMNDiagram');
      if (diIdx > 0) processedContent = processedContent.slice(0, diIdx) + '\n</bpmn:definitions>';
    }
  }

  // ─── Sənəd Modu Promptu ──────────────────────────────────────────────────
  let systemPrompt, userMsg;

  if (isDocument) {
    systemPrompt = `You are a senior IT Business Analyst with 10+ years of experience. You will be given a document (SRS, BRD, specification, or other business document). Your task is to extract Acceptance Criteria from the requirements described in the document.

RULES:
- Extract AC only from what is explicitly written in the document
- Do not invent requirements not mentioned in the document
- Each AC must be testable and specific
- Write all output in ${langLabel} language
- Group related requirements under meaningful titles
- Output ONLY a raw JSON array. No markdown, no explanation. Start with [ end with ]`;

    userMsg = `Analyze this business document and extract Acceptance Criteria for all requirements.

JSON FORMAT:
[{
  "id": "AC-001",
  "title": "Requirement group title in ${langLabel}",
  "priority": "High|Medium|Low",
  "element_type": "functional|non-functional|business-rule|constraint",
  "diagram_element": "Section or requirement reference from document",
  "lane": "",
  "acceptance_criteria": [
    "The system must [specific testable requirement]."
  ]
}]

Write in ${langLabel}. Output JSON array only.

Document content:
${processedContent.slice(0, 15000)}`;

  } else {
    // ─── Diaqram Modu Promptu ───────────────────────────────────────────────
    systemPrompt = `Sən 10+ il təcrübəli senior IT Business Analyst-sən. Sənə ${isBpmn ? 'BPMN/Camunda XML' : 'UML'} diaqramı veriləcək.

ƏN VACIB QAYDA — YALNIZ DİAQRAMDA OLANLAR
Sən YALNIZ diaqramda açıq şəkildə yazılmış məlumatları əsas götürməlisən.
Diaqramda yazılmayan heç bir şeyi uydurmaq QƏTI QADAĞANDIR.

QADAĞAN OLAN DAVRANIŞLAR:
❌ Diaqramda olmayan limit uydurmaq ("maksimum 500 simvol", "3 cəhd" kimi)
❌ Diaqramda olmayan field uydurmaq ("nömrəsi, tarixi, məbləği, təsviri" kimi)
❌ Diaqramda olmayan geri qayıtma məntiqi uydurmaq
❌ Diaqramda olmayan vaxt məhdudiyyəti uydurmaq ("3 saniyə ərzində" kimi)
❌ Diaqramda olmayan texniki detal uydurmaq
❌ Ümumi "best practice" əlavə etmək

DÜZGÜN DAVRANIŞLAR:
✅ Task adı → bu əməliyyatın biznes məqsədini yaz
✅ sequenceFlow name → gateway şərtini yaz (diaqramda yazılıb)
✅ textAnnotation mətn → müvafiq task-ın AC-sına əlavə et
✅ lane adı → kimin icra etdiyini yaz
✅ boundaryEvent → xəta halının varlığını yaz, detal uydurmaq yoxdur
✅ exclusiveGateway → hər branch ayrı ssenari olsun

BPMN XML OXUMA QAYDASI:
• bpmn:textAnnotation — State məlumatları
• bpmn:sequenceFlow name — gateway şərti
• bpmn:lane name — rollar
• bpmn:boundaryEvent — xəta/timeout var
• bpmn:exclusiveGateway — hər outgoing flow ayrı ssenari

ÇIXIŞ: Yalnız xam JSON array. Heç bir izahat, markdown, code fence yoxdur. [ ilə başla ] ilə bitir.
Bütün mətn ${langLabel} dilində yazılmalıdır.`;

    userMsg = `Bu ${diagLabel} (${fmtLabel}) diaqramını analiz et.

Diaqramdakı HƏR elementi tap: task, gateway, event, annotation.
Hər element üçün YALNIZ DİAQRAMDA OLAN məlumatları əsas götür.
Heç bir elementi buraxma, heç bir şey uydurma.

JSON FORMAT:
[{
  "id": "AC-001",
  "title": "Elementin biznes funksiyasını əks etdirən başlıq",
  "priority": "High|Medium|Low",
  "element_type": "userTask|serviceTask|scriptTask|exclusiveGateway|parallelGateway|eventBasedGateway|startEvent|endEvent|boundaryEvent|annotation",
  "diagram_element": "Diaqramdakı elementin dəqiq adı",
  "lane": "Elementin aid olduğu lane/rol adı (varsa)",
  "acceptance_criteria": [
    "Sistem/İstifadəçi [YALNIZ DİAQRAMDA OLAN məlumata əsaslanan tələb]."
  ]
}]

${langLabel} dilində yaz. Yalnız JSON array çıxar.

Diaqram:
${processedContent}`;
  }

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.Claude_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8000,
        stream: true,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }]
      })
    });

    if (!anthropicRes.ok) {
      const errTxt = await anthropicRes.text();
      let errBody;
      try { errBody = JSON.parse(errTxt); } catch { errBody = { raw: errTxt }; }
      return res.status(500).json({
        error: errBody?.error?.message || `HTTP ${anthropicRes.status}`,
        details: errBody
      });
    }

    let fullText = '';
    const reader = anthropicRes.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            fullText += parsed.delta.text;
          }
        } catch { /* keç */ }
      }
    }

    if (!fullText.trim()) return res.status(500).json({ error: 'Bos cavab' });

    const start = fullText.indexOf('[');
    const end = fullText.lastIndexOf(']');
    if (start === -1 || end === -1) {
      return res.status(500).json({ error: 'JSON tapilmadi', raw: fullText.slice(0, 500) });
    }

    let jsonStr = fullText.slice(start, end + 1)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/,(\s*[}\]])/g, '$1');

    let items;
    try {
      items = JSON.parse(jsonStr);
    } catch {
      const lastComplete = jsonStr.lastIndexOf('},');
      if (lastComplete > 0) {
        try {
          items = JSON.parse(jsonStr.slice(0, lastComplete + 1) + ']');
        } catch {
          return res.status(500).json({ error: 'JSON parse xetasi', raw: jsonStr.slice(0, 500) });
        }
      } else {
        return res.status(500).json({ error: 'JSON parse xetasi', raw: jsonStr.slice(0, 500) });
      }
    }

    if (!Array.isArray(items) || !items.length) {
      return res.status(500).json({ error: 'Bos array' });
    }

    return res.status(200).json({ items, detectedLang });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
