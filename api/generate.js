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
    const keep = lines.filter(l => {
      const t = l.trim();
      if (!t) return false;
      if (t.match(/BPMNEdge|BPMNShape|waypoint|dc:Bounds|di:waypoint|bpmndi:/)) return false;
      return true;
    });
    processedUml = keep.join('\n');
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
- Diaqramda olmayan field uydurmaq ("nömrəsi, tarixi, məbləği, təsviri" kimi)
- Diaqramda olmayan geri qayıtma məntiqi uydurmaq
- Diaqramda olmayan vaxt məhdudiyyəti uydurmaq ("3 saniyə ərzində" kimi)
- Diaqramda olmayan texniki detal uydurmaq
- Ümumi "best practice" əlavə etmək

DÜZGÜN DAVRANIŞLAR:
- Task adı: bu əməliyyatın biznes məqsədini yaz
- sequenceFlow name: gateway şərtini yaz (diaqramda yazılıb)
- textAnnotation mətn: müvafiq task-ın AC-sına əlavə et
- lane adı: kimin icra etdiyini yaz
- boundaryEvent: xəta halının varlığını yaz, detal uydurmaq yoxdur
- eventBasedGateway: hər outgoing event seçimini ayrı meyar kimi yaz

BPMN XML OXUMA QAYDASI:
- bpmn:textAnnotation — State məlumatları buradadır
- bpmn:sequenceFlow name — gateway şərti buradadır
- bpmn:lane name — rollar buradadır
- bpmn:boundaryEvent — xəta/timeout var deməkdir
- bpmn:exclusiveGateway — hər outgoing flow ayrı ssenari

ÇIXIŞ: Yalnız xam JSON array. Heç bir izahat, markdown, code fence yoxdur. [ ilə başla ] ilə bitir.`;

  const userMsg = `Bu ${diagLabel} (${fmtLabel}) diaqramını analiz et.

1. Diaqramdakı HƏR elementi tap: task, gateway, event, annotation
2. Hər element üçün YALNIZ DİAQRAMDA OLAN məlumatları əsas götür
3. textAnnotation varsa müvafiq task-ın AC-sına əlavə et
4. sequenceFlow adları gateway şərtlərini verir, hər branch ayrı ssenari olsun
5. Boundary Event varsa xəta emal axınının mövcudluğunu yaz
6. Heç bir elementi buraxma, heç bir şey uydurma

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

Azərbaycan dilində yaz. Yalnız JSON array çıxar.

Diaqram:
${processedUml}`;

  try {
    const apiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://ac-generator-blond.vercel.app',
        'X-Title': 'AC Generator'
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-5',
        max_tokens: 8000,
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg }
        ]
      })
    });

    const txt = await apiRes.text();

    if (!txt || txt.trim().startsWith('<') || txt.trim().startsWith('A server')) {
      return res.status(500).json({ error: 'Server xetasi: ' + txt.slice(0, 100) });
    }

    if (!apiRes.ok) {
      let msg = 'HTTP ' + apiRes.status;
      try { msg = JSON.parse(txt).error?.message || msg; } catch {}
      return res.status(500).json({ error: msg });
    }

    let data;
    try { data = JSON.parse(txt); } catch {
      return res.status(500).json({ error: 'Response parse xetasi', raw: txt.slice(0, 200) });
    }

    const fullText = data?.choices?.[0]?.message?.content || '';
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

    return res.status(200).json({ items });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
