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
  if (uml.length > 8000) {
    const lines = uml.split('\n');
    const keep = lines.filter(l => {
      const t = l.trim();
      return (
        t.includes('name=') || t.includes('id=') ||
        t.match(/userTask|serviceTask|scriptTask|sendTask|receiveTask|manualTask|businessRuleTask/) ||
        t.match(/startEvent|endEvent|intermediateCatch|intermediateThrow|boundaryEvent/) ||
        t.match(/exclusiveGateway|parallelGateway|inclusiveGateway|eventBasedGateway|complexGateway/) ||
        t.match(/sequenceFlow|messageFlow|subProcess|callActivity/) ||
        t.match(/lane|Lane|participant|Participant|pool|Pool/) ||
        t.match(/\|[^|]+\|/) ||
        t.match(/^\s*(if|else|elseif|repeat|while|fork|split|:)/)
      );
    });
    processedUml = keep.join('\n');
    if (processedUml.length > 8000) processedUml = processedUml.slice(0, 8000);
  }

  const systemPrompt = `Sən 10+ il təcrübəli senior IT Business Analyst-sən. Sənə ${isBpmn ? 'BPMN/Camunda' : 'UML'} diaqramı veriləcək. Sənin vəzifən bu diaqramdakı HƏR TASK, GATEWAY və EVENT üçün REAL BİZNES TƏLƏBLƏRİ şəklində Acceptance Criteria yazmaqdir.

ƏN VACIB QAYDA:
Sən diaqramı TƏRIF ETMİRSƏN. Sən diaqramdakı hər elementin arxasındakı BİZNES TƏLƏBLƏRİNİ yazırsan.

YANLIŞIN nümunəsi - BU CÜR YAZMA:
- "Bu task növbəti taska keçid edir."
- "Proses bu addımdan sonra davam edir."
- "İstifadəçi formu doldurduqdan sonra növbəti addıma keçir."
- "Sistem bu tapşırığı icra edir."

DOĞRUNUN nümunəsi - BU CÜR YAZ:
- "Sistem istifadəçi daxil etdiyi e-poçt ünvanının formatını yoxlamalı və düzgün format olmadıqda xəta mesajı göstərməlidir."
- "Sistem uğursuz cəhdləri qeyd etməli və 5 ardıcıl uğursuz cəhddən sonra hesabı müvəqqəti bloklamalıdır."
- "Sistem sifariş yalnız Draft statusunda olduqda redaktə edilməsinə icazə verməlidir."
- "Sistem istifadəçi sessiyası 15 dəqiqə aktivlik olmadıqda avtomatik olaraq sona çatdırılmalıdır."
- "Sistem məlumat bazasında saxlanılan bütün kritik əməliyyatları audit log-da qeyd etməlidir."
- "Sistem sistem xətaları baş verdikdə istifadəçiyə ümumi xəta mesajı göstərməli, texniki detalları log faylında saxlamalıdır."

HƏR ELEMENT ÜÇÜN DÜŞÜNMƏLİ OLDUĞUN SUALLAR:
1. Bu task/qərar/hadisə REAL HƏYATDA nə deməkdir? Hansı biznes prosesini idarə edir?
2. Bu elementin düzgün icra olunması üçün SİSTEM nə etməlidir?
3. Hansı VALİDASİYA qaydaları tətbiq edilməlidir?
4. Hansı MƏHDUDİYYƏTLƏR var? (status, icazə, limit, format)
5. XƏTA halında sistem nə etməlidir?
6. Gateway üçün: hər QƏRAR BRANCH-ı hansı biznes şərtinə əsaslanır?

AC YAZMA FORMATI:
- Hər cümlə "Sistem ..." və ya "İstifadəçi ..." ilə başlamalıdır
- Cümlə konkret, ölçülə bilən, test edilə bilən olmalıdır
- Biznes qaydaları, validasiyalar, məhdudiyyətlər əks olunmalıdır
- Yalnız Azərbaycan dilində yaz

ÇIXIŞ: Yalnız xam JSON array. Heç bir izahat, markdown, code fence yoxdur. [ ilə başla ] ilə bitir.`;

  const userMsg = `Bu ${diagLabel} (${fmtLabel}) diaqramını analiz et.

Hər task, gateway və event üçün REAL BİZNES TƏLƏBLƏRİ yaz — diaqramı təsvir etmə, sistemin NƏ etməli olduğunu yaz.

JSON FORMAT:
[{
  "id": "AC-001",
  "title": "elementin biznes funksiyasını əks etdirən başlıq",
  "priority": "High|Medium|Low",
  "element_type": "userTask|serviceTask|exclusiveGateway|parallelGateway|startEvent|endEvent|boundaryEvent|subprocess",
  "diagram_element": "diaqramdakı elementin dəqiq adı",
  "acceptance_criteria": [
    "Sistem [spesifik biznes tələbi və ya validasiya qaydası].",
    "Sistem [məhdudiyyət və ya xəta halı üçün davranış].",
    "Sistem [uğurlu ssenari üçün gözlənilən nəticə].",
    "İstifadəçi [icazə verilən və ya qadağan olan əməliyyat]."
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
