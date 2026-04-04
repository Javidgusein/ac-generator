export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { uml, diagType, fmt } = req.body;
  if (!uml) return res.status(400).json({ error: 'Content is required' });

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

  let processedUml = uml;
  if (isBpmn && uml.length > 12000) {
    const lines = uml.split('\n');
    processedUml = lines.filter(l => {
      const t = l.trim();
      if (!t) return false;
      if (t.match(/BPMNEdge|BPMNShape|waypoint|dc:Bounds|di:waypoint|bpmndi:/)) return false;
      return true;
    }).join('\n');
    if (processedUml.length > 12000) {
      const diIdx = processedUml.indexOf('<bpmndi:BPMNDiagram');
      if (diIdx > 0) processedUml = processedUml.slice(0, diIdx) + '\n</bpmn:definitions>';
    }
  }

  const systemPrompt = `Sən 10+ il təcrübəli senior IT Business Analyst-sən. Sənə ${isBpmn ? 'BPMN/Camunda XML' : 'UML'} diaqramı veriləcək.

ƏN VACIB QAYDA — YALNIZ DİAQRAMDA OLANLAR
Sən YALNIZ diaqramda açıq şəkildə yazılmış məlumatları əsas götürməlisən.
Diaqramda yazılmayan heç bir şeyi uydurmaq QƏTI QADAĞANDIR.

QADAĞAN OLAN DAVRANIŞLAR:
- Diaqramda olmayan limit uydurmaq ("maksimum 500 simvol", "3 cəhd" kimi)
- Diaqramda olmayan field uydurmaq
- Diaqramda olmayan vaxt məhdudiyyəti uydurmaq
- Ümumi "best practice" əlavə etmək

DÜZGÜN DAVRANIŞLAR:
- Task adı: bu əməliyyatın biznes məqsədini yaz
- sequenceFlow name: gateway şərtini yaz (diaqramda yazılıb)
- textAnnotation: müvafiq task-ın AC-sına əlavə et
- lane adı: kimin icra etdiyini yaz
- boundaryEvent: xəta halının varlığını yaz, detal uydurmaq yoxdur
- exclusiveGateway: hər branch ayrı ssenari olsun

BPMN XML OXUMA QAYDASI:
- bpmn:textAnnotation — State məlumatları
- bpmn:sequenceFlow name — gateway şərti
- bpmn:lane name — rollar
- bpmn:boundaryEvent — xəta/timeout var
- bpmn:exclusiveGateway — hər outgoing flow ayrı ssenari

ÇIXIŞ: Yalnız xam JSON array. Heç bir izahat, markdown, code fence yoxdur. [ ilə başla ] ilə bitir.`;

  const userMsg = `Bu ${diagLabel} (${fmtLabel}) diaqramını analiz et.

Diaqramdakı HƏR elementi tap: task, gateway, event, annotation.
Hər element üçün YALNIZ DİAQRAMDA OLAN məlumatları əsas götür.
Heç bir elementi buraxma, heç bir şey uydurma.

JSON FORMAT:
[{
  "id": "AC-001",
  "title": "Elementin biznes funksiyasını əks etdirən başlıq",
  "priority": "High|Medium|Low",
  "element_type": "userTask|serviceTask|exclusiveGateway|parallelGateway|eventBasedGateway|startEvent|endEvent|boundaryEvent|annotation",
  "diagram_element": "Diaqramdakı elementin dəqiq adı",
  "lane": "Elementin aid olduğu lane/rol adı (varsa)",
  "acceptance_criteria": [
    "Sistem/İstifadəçi [YALNIZ DİAQRAMDA OLAN məlumata əsaslanan tələb]."
  ]
}]

Azərbaycan dilində yaz. Yalnız JSON array çıxar.

Diaqram:
${processedUml}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.Claude_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }]
      })
    });

    const txt = await response.text();
    if (!response.ok) {
      let msg = 'HTTP ' + response.status;
      try { msg = JSON.parse(txt).error?.message || msg; } catch {}
      return res.status(500).json({ error: msg });
    }

    const data = JSON.parse(txt);
    const raw = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    if (!raw.trim()) return res.status(500).json({ error: 'Bos cavab' });

    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start === -1 || end === -1) return res.status(500).json({ error: 'JSON tapilmadi', raw: raw.slice(0, 200) });

    let jsonStr = raw.slice(start, end + 1)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/,(\s*[}\]])/g, '$1');

    let items;
    try {
      items = JSON.parse(jsonStr);
    } catch {
      const lastComplete = jsonStr.lastIndexOf('},');
      if (lastComplete > 0) {
        try { items = JSON.parse(jsonStr.slice(0, lastComplete + 1) + ']'); } catch {
          return res.status(500).json({ error: 'JSON parse xetasi' });
        }
      } else {
        return res.status(500).json({ error: 'JSON parse xetasi' });
      }
    }

    if (!Array.isArray(items) || !items.length) return res.status(500).json({ error: 'Bos array' });
    return res.status(200).json({ items });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
