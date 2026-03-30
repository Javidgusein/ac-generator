export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { uml, diagType, fmt, lang } = req.body;
  if (!uml) return res.status(400).json({ error: 'Content is required' });

  const diagLabel = {
    'use-case': 'Use Case Diagram', 'sequence': 'Sequence Diagram',
    'class': 'Class Diagram', 'activity': 'Activity Diagram', 'bpmn': 'BPMN Process Diagram'
  }[diagType] || 'Activity Diagram';

  const fmtLabel = {
    'auto': 'auto-detected', 'mermaid': 'Mermaid',
    'plantuml': 'PlantUML', 'camunda-xml': 'Camunda BPMN XML'
  }[fmt] || 'auto-detected';

  const langLabel = {
    'az': 'Azerbaijani', 'en': 'English', 'ru': 'Russian', 'tr': 'Turkish'
  }[lang] || 'Azerbaijani';

  const langKeywords = {
    'az': { given: 'Verilmishdir', when: 'Ne zaman ki', then: 'Onda' },
    'en': { given: 'Given', when: 'When', then: 'Then' },
    'ru': { given: 'Dano', when: 'Kogda', then: 'Togda' },
    'tr': { given: 'Verildiginde', when: 'Ne zaman', then: 'O zaman' }
  }[lang] || { given: 'Given', when: 'When', then: 'Then' };

  const { given, when, then } = langKeywords;
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

  const systemPrompt = `You are a senior Business Analyst expert in Gherkin BDD Acceptance Criteria writing.
Output ONLY a raw JSON array. No markdown, no explanation, no code fences. Start with [ end with ].

STRICT RULES:
- Each AC must be UNIQUE - never repeat the same sentence
- Each AC MUST follow: "${given} [specific context] ${when} [specific action] ${then} [specific verifiable result]"
- All text in ${langLabel} language only
- No apostrophes or special quotes inside JSON string values
- Extract AC for EVERY task, gateway, event in the diagram`;

  const userMsg = `Analyze this ${diagLabel} (${fmtLabel}) completely. Write Acceptance Criteria in ${langLabel} for every element.

JSON format:
[{"id":"AC-001","title":"element title","priority":"High|Medium|Low","element_type":"userTask|serviceTask|gateway|startEvent|endEvent|boundaryEvent","diagram_element":"exact name","acceptance_criteria":["${given} [context] ${when} [action] ${then} [result]","${given} [context] ${when} [action] ${then} [result]","${given} [context] ${when} [action] ${then} [result]"]}]

Rules: 1 object per task/gateway/event, 3-5 unique AC each, cover all gateway branches, never repeat text.

Diagram:
${processedUml}`;

  // Fallback zənciri — biri xəta versə növbətiyə keçir
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
          temperature: 0.1,
          max_tokens: 6000,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsg }
          ]
        })
      });

      const txt = await response.text();

      // Server xətası və ya HTML cavab gəlsə növbətiyə keç
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
    error: 'Bütün modellər xəta verdi. Bir az gözləyib yenidən cəhd edin.',
    detail: lastError?.message
  });
}
