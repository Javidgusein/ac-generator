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

  const systemPrompt = `Sən 10+ il təcrübəli senior IT Business Analyst-sən. Sənin vəzifən ${isBpmn ? 'BPMN/Camunda' : 'UML'} diaqramlarını dərindən analiz edərək peşəkar Acceptance Criteria-lar yazmaqdir.

DÜŞÜNCƏ PROSESİ - hər element üçün özünə bu sualları ver:
1. Bu elementin REAL BİZNES MƏQSƏDİ nədir? Hansı iş prosesini əhatə edir?
2. KİM icra edir? İstifadəçimi, sistemmi, xarici servismi?
3. Hansı ŞƏRTLƏRİ olmalıdır ki, bu addım icra edilsin?
4. Nə baş verdikdə bu proses UĞURLU hesab olunur?
5. Nə baş verdikdə UĞURSUZ hesab olunur? Xəta ssenarisləri nələrdir?
6. Qaytarma nöqtəsi, timeout, məhdudiyyət varmı?

AC KƏYFİYYƏT STANDARTLARI:
- Hər AC FƏRQLI bir biznes ssenarisi və ya edge case-i əhatə etməlidir
- AC-lar ümumi deyil, SPESIFIK olmalıdır - dəqiq sistem davranışını əks etdirməlidir
- Gateway elementləri üçün HƏR branch üçün ayrı AC yaz - qərar məntiqi aydın olmalıdır
- Tapşırıqlar üçün: uğurlu axın, validasiya qaydaları, xəta halları
- Sistem tərəfindən icra olunan addımlar üçün: giriş şərtləri, çıxış nəticəsi, uğursuzluq halı
- AC mütləq TEST EDİLƏ BİLƏN olmalıdır - QA mühəndisi bu AC əsasında test yaza bilməlidir
- Element adını mexaniki kopyalama - elementin NƏ ETDIYINI izah et

QADAĞAN:
- Eyni cümləni fərqli AC-larda təkrarlama
- "sistem işləyir", "proses davam edir" kimi mənasız ifadələr
- Element adını olduğu kimi AC mətninə kopyalama

ÇIXIŞ: Yalnız xam JSON array. Heç bir izahat, markdown, code fence yoxdur. [ ilə başla ] ilə bitir.
Bütün mətn Azərbaycan dilində olmalıdır.`;

  const userMsg = `Bu ${diagLabel} (${fmtLabel}) diaqramını başdan-sona analiz et. Hər task, gateway, event və subprocess üçün peşəkar Acceptance Criteria yaz.

ÇIXIŞ FORMATI (yalnız JSON array):
[{
  "id": "AC-001",
  "title": "elementin biznes mənasını əks etdirən başlıq",
  "priority": "High|Medium|Low",
  "element_type": "userTask|serviceTask|exclusiveGateway|parallelGateway|startEvent|endEvent|boundaryEvent|subprocess|lane",
  "diagram_element": "diaqramdakı elementin dəqiq adı",
  "acceptance_criteria": [
    "Sistem [spesifik şərt olduqda] [spesifik davranışı] icra etməlidir",
    "İstifadəçi [spesifik şərt altında] [spesifik əməliyyatı] edə bilməlidir",
    "[Xüsusi vəziyyət] baş verdikdə sistem [spesifik reaksiya] verməlidir",
    "[Xəta/uğursuzluq halında] sistem [spesifik davranış] göstərməlidir"
  ]
}]

Azərbaycan dilində yaz. Yalnız JSON array çıxar.

Diaqram:
${processedUml}`;

  const models = [
    'openrouter/auto',
    'meta-llama/llama-3.3-70b-instruct:free',
    'mistralai/mistral-small-3.1-24b-instruct:free',
    'google/gemma-3-27b-it:free'
  ];

  let lastError = null;

  for (const model of models) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://ac-generator-blond.vercel.app',
          'X-Title': 'AC Generator'
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 6000,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsg }
          ]
        })
      });

      const txt = await response.text();

      if (!txt || txt.trim().startsWith('<') || txt.trim().startsWith('A server')) {
        lastError = new Error('Server xetasi: ' + txt.slice(0, 80));
        continue;
      }

      if (!response.ok) {
        let msg = 'HTTP ' + response.status;
        try { msg = JSON.parse(txt).error?.message || msg; } catch {}
        lastError = new Error(msg);
        continue;
      }

      let data;
      try { data = JSON.parse(txt); } catch {
        lastError = new Error('Response parse xetasi');
        continue;
      }

      const raw = data?.choices?.[0]?.message?.content || '';
      if (!raw.trim()) { lastError = new Error('Bos cavab'); continue; }

      const start = raw.indexOf('[');
      const end = raw.lastIndexOf(']');
      if (start === -1 || end === -1) { lastError = new Error('JSON tapilmadi'); continue; }

      let jsonStr = raw.slice(start, end + 1)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .replace(/,(\s*[}\]])/g, '$1')
        .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');

      let items;
      try {
        items = JSON.parse(jsonStr);
      } catch {
        const lastComplete = jsonStr.lastIndexOf('},');
        if (lastComplete > 0) {
          try { items = JSON.parse(jsonStr.slice(0, lastComplete + 1) + ']'); } catch {
            lastError = new Error('JSON parse xetasi');
            continue;
          }
        } else {
          lastError = new Error('JSON parse xetasi');
          continue;
        }
      }

      if (!Array.isArray(items) || !items.length) {
        lastError = new Error('Bos array');
        continue;
      }

      return res.status(200).json({ items });

    } catch (err) {
      lastError = err;
      continue;
    }
  }

  return res.status(500).json({
    error: 'Butun modeller xeta verdi. Bir az gozleyib yeniden ced edin.',
    detail: lastError?.message
  });
}
