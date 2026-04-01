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

  // ─── BPMN PREPROCESSING ───────────────────────────────────────────────────
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
  // ─────────────────────────────────────────────────────────────────────────

  const systemPrompt = `Sən 10+ il təcrübəli senior IT Business Analyst-sən. Sənə ${isBpmn ? 'BPMN/Camunda XML' : 'UML'} diaqramı veriləcək.

═══════════════════════════════════════════
ƏN VACIB QAYDA — YALNIZ DİAQRAMDA OLANLAR
═══════════════════════════════════════════
Sən YALNIZ diaqramda açıq şəkildə yazılmış məlumatları əsas götürməlisən.
Diaqramda yazılmayan heç bir şeyi uydurmaq QƏTI QADAĞANDIR.

QADAĞAN OLAN DAVRANIŞLAR:
❌ Diaqramda olmayan limit uydurmaq ("maksimum 500 simvol", "3 cəhd" kimi)
❌ Diaqramda olmayan field uydurmaq ("nömrəsi, tarixi, məbləği, təsviri" kimi)
❌ Diaqramda olmayan geri qayıtma məntiqi uydurmaq
❌ Diaqramda olmayan vaxt məhdudiyyəti uydurmaq ("3 saniyə ərzində" kimi)
❌ Diaqramda olmayan texniki detal uydurmaq ("LDAP", "audit log" — yalnız annotasiyada varsa yaz)
❌ Ümumi "best practice" əlavə etmək — sənin vəzifən yalnız DİAQRAMI oxumaqdır

DÜZGÜN DAVRANIŞLAR:
✅ Task adı → bu əməliyyatın biznes məqsədini yaz
✅ sequenceFlow name → gateway şərtini yaz (diaqramda yazılıb)
✅ textAnnotation mətn → State və tarixçə dəyərini müvafiq task-ın AC-sına əlavə et (diaqramda yazılıb)
✅ lane adı → kimin icra etdiyini yaz (diaqramda yazılıb)
✅ boundaryEvent → xəta halının varlığını yaz, amma xəta detalını uydurmaq yoxdur
✅ eventBasedGateway → hər outgoing event seçimini ayrı meyar kimi yaz (diaqramda yazılıb)

YOXLAMA SUALIN:
Hər AC cümləsi yazmadan əvvəl özünə sor:
"Bu məlumat diaqramın hansı elementindən gəlir?"
Əgər konkret element göstərə bilmirsənsə — O CÜMLƏNİ YAZMA.

═══════════════════════════════════════════
BPMN XML OXUMA QAYDASI
═══════════════════════════════════════════
• <bpmn:textAnnotation> — State və tarixçə məlumatları buradadır, müvafiq task-a əlavə et
• <bpmn:sequenceFlow name="..."> — gateway şərti buradadır, hər branch ayrı ssenari olmalıdır
• <bpmn:lane name="..."> — rollar buradadır, "İstifadəçi [rol]" şəklində yaz
• <bpmn:boundaryEvent> — xəta/timeout mövcuddur, emal axını var deməkdir
• <bpmn:eventBasedGateway> — hər outgoing event istifadəçi seçimidir
• <bpmn:exclusiveGateway> — hər outgoing flow ayrı ssenari (Ssenari A, Ssenari B...)

ÇIXIŞ FORMATI:
Yalnız xam JSON array. Heç bir izahat, markdown, code fence yoxdur. [ ilə başla ] ilə bitir.`;

  const userMsg = `Bu ${diagLabel} (${fmtLabel}) diaqramını analiz et.

TAPŞIRIQ:
1. Diaqramdakı HƏR elementi tap: task, gateway, event, annotation
2. Hər element üçün YALNIZ DİAQRAMDA OLAN məlumatları əsas götür
3. textAnnotation-da State/tarixçə varsa — müvafiq task-ın AC-sına əlavə et
4. sequenceFlow adları gateway şərtlərini verir — hər branch ayrı ssenari olsun
5. Boundary Event varsa — xəta emal axınının mövcudluğunu yaz, detal uydurmaq yoxdur
6. Heç bir elementi buraxma, heç bir şey uydurma

JSON FORMAT:
[{
  "id": "AC-001",
  "title": "Elementin biznes funksiyasını əks etdirən başlıq",
  "priority": "High|Medium|Low",
  "element_type": "userTask|serviceTask|scriptTask|sendTask|receiveTask|exclusiveGateway|parallelGateway|eventBasedGateway|startEvent|endEvent|intermediateEvent|boundaryEvent|annotation",
  "diagram_element": "Diaqramdakı elementin dəqiq adı",
  "lane": "Elementin aid olduğu lane/rol adı (varsa)",
  "acceptance_criteria": [
    "Sistem/İstifadəçi [YALNIZ DİAQRAMDA OLAN məlumata əsaslanan tələb]."
  ]
}]

Xatırla: Hər AC cümləsinin mənbəyi diaqramın konkret bir elementindən gəlməlidir.

Azərbaycan dilində yaz. Yalnız JSON array çıxar.

Diaqram:
${processedUml}`;

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.Claude_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
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

    // Stream-i oxu, text-i topla
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

    return res.status(200).json({ items });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}
