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
  // Əvvəlki versiyada TextAnnotation-lar, flow adları (şərt mətni), gateway
  // adları kəsilirdi. Bu məlumatlar AC üçün ən vacibdir — indi saxlanılır.
  let processedUml = uml;
  if (isBpmn && uml.length > 12000) {
    const lines = uml.split('\n');
    const keep = lines.filter(l => {
      const t = l.trim();
      // Boş sətirləri at
      if (!t) return false;
      // DI/görsel koordinat bloklarını at (bunlar biznes mənası daşımır)
      if (t.match(/BPMNEdge|BPMNShape|waypoint|Bounds|BPMNLabel/)) return false;
      if (t.match(/dc:Bounds|di:waypoint|bpmndi:/)) return false;
      // Qalan hər şeyi saxla: task adları, annotation mətnləri,
      // gateway adları, flow adları (şərtlər), lane adları, event adları
      return true;
    });
    processedUml = keep.join('\n');
    // Hələ də böyükdürsə, strukturu qoru amma DI hissəsini kəs
    if (processedUml.length > 12000) {
      const diIdx = processedUml.indexOf('<bpmndi:BPMNDiagram');
      if (diIdx > 0) processedUml = processedUml.slice(0, diIdx) + '\n</bpmn:definitions>';
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const systemPrompt = `Sən 10+ il təcrübəli senior IT Business Analyst-sən. Sənə ${isBpmn ? 'BPMN/Camunda XML' : 'UML'} diaqramı veriləcək.

SƏNİN VƏZİFƏN:
Diaqramdakı HƏR TASK, HƏR GATEWAY, HƏR EVENT və HƏR ANNOTATION üçün heç birini buraxmadan REAL BİZNES TƏLƏBLƏRİ şəklində Acceptance Criteria yaz.

═══════════════════════════════════════════
BPMN XML OXUMA QAYDASI (çox vacib):
═══════════════════════════════════════════
• <bpmn:textAnnotation> içindəki mətn State və tarixçə məlumatlarını verir — bunları mütləq müvafiq task-ın AC-sına əlavə et.
• <bpmn:sequenceFlow name="..."> içindəki ad gateway şərtini bildirir — hər şərt ayrı AC meyarı olmalıdır.
• <bpmn:lane name="..."> rolları bildirir — AC-da "Sistem" və ya "İstifadəçi [rol adı]" şəklində yaz.
• <bpmn:boundaryEvent> — xəta/timeout emal ssenarisi kimi AC yaz.
• <bpmn:eventBasedGateway> — istifadəçiyə təqdim olunan hər seçim (hər outgoing event) ayrı AC meyarı olmalıdır.
• Hər exclusiveGateway üçün HƏR çıxış branch-ı (outgoing sequenceFlow) üçün ayrı ssenari yaz (Ssenari A, Ssenari B, ...).

═══════════════════════════════════════════
YAZMA QAYDALARI:
═══════════════════════════════════════════
❌ YAZMA (diaqram təsviri):
- "Bu task növbəti taska keçid edir."
- "Proses bu addımdan sonra davam edir."
- "Gateway şərti yoxlayır."

✅ YAZ (biznes tələbi):
- "Sistem seçilmiş şəxsin müvafiq əməliyyat üzrə səlahiyyətini LDAP/rol registrindən real vaxtda sorğulamalı, nəticəni 3 saniyə ərzində qaytarmalıdır."
- "Sistem status 'Akt icazəyə göndərilib' olaraq yenilədikdə dəyişiklik vaxtı, istifadəçi ID-si və köhnə status dəyəri audit log-da qeyd edilməlidir."
- "Sistem xəta baş verdikdə istifadəçiyə texniki detallar göstərməməli, ümumi xəta mesajı ilə yönləndirməlidir; xəta stack trace-i server tərəfli log-da saxlanılmalıdır."
- "Sistem cari tarixi (Yoxlamanın bitdiyi tarix + 10 gün) ilə müqayisə etməli; cari tarix bu həddən böyükdürsə əməliyyat avtomatik deaktiv edilməlidir."

HƏR ELEMENT ÜÇÜN DÜŞÜN:
1. Bu element real həyatda hansı biznes prosesini idarə edir?
2. Validasiya qaydaları nələrdir? (format, status, limit, icazə)
3. Xəta halında sistem nə etməlidir?
4. Audit/tarixçə tələbi varmı? (annotation-da varsa mütləq yaz)
5. Performans/vaxt tələbi varmı?
6. Rol/səlahiyyət tələbi varmı?

═══════════════════════════════════════════
ÇIXIŞ FORMATI:
═══════════════════════════════════════════
Yalnız xam JSON array. Heç bir izahat, markdown, code fence yoxdur. [ ilə başla ] ilə bitir.`;

  const userMsg = `Bu ${diagLabel} (${fmtLabel}) diaqramını analiz et.

TAPŞIRIQ:
1. Diaqramdakı HƏR elementi (task, gateway, event, annotation) tap
2. Hər biri üçün REAL BİZNES TƏLƏBLƏRİ yaz — diaqramı təsvir etmə
3. TextAnnotation-larda State və tarixçə məlumatları varsa müvafiq task-ın AC-sına əlavə et
4. Gateway-lərdə hər branch üçün ayrı ssenari yaz (Ssenari A, Ssenari B...)
5. Boundary Event-lər üçün xəta emal ssenarisi yaz
6. Heç bir elementi buraxma

JSON FORMAT:
[{
  "id": "AC-001",
  "title": "Elementin biznes funksiyasını əks etdirən başlıq",
  "priority": "High|Medium|Low",
  "element_type": "userTask|serviceTask|scriptTask|sendTask|receiveTask|exclusiveGateway|parallelGateway|eventBasedGateway|startEvent|endEvent|intermediateEvent|boundaryEvent|annotation",
  "diagram_element": "Diaqramdakı elementin dəqiq adı",
  "lane": "Elementin aid olduğu lane/rol adı (varsa)",
  "acceptance_criteria": [
    "Sistem [spesifik biznes tələbi — validasiya, məhdudiyyət, davranış].",
    "Sistem [xəta halı üçün davranış].",
    "Sistem [audit/tarixçə tələbi — annotation-dan gələn məlumat].",
    "İstifadəçi [rol üzrə icazə verilən/qadağan əməliyyat]."
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
        // ✅ Haiku → Sonnet 4: kompleks analiz üçün çox daha güclü
        model: 'claude-sonnet-4-20250514',
        // ✅ 4000 → 8000: böyük BPMN-lər üçün cavab kəsilmir
        max_tokens: 8000,
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
    if (start === -1 || end === -1) {
      return res.status(500).json({ error: 'JSON tapilmadi', raw: raw.slice(0, 200) });
    }

    let jsonStr = raw.slice(start, end + 1)
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
          return res.status(500).json({ error: 'JSON parse xetasi' });
        }
      } else {
        return res.status(500).json({ error: 'JSON parse xetasi' });
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
