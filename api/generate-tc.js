export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { acText, items } = req.body;

  // İki giriş növünü dəstəklə: text (yeni səhifə) və ya items array (köhnə)
  let acContent = '';
  if (acText && acText.trim()) {
    acContent = acText.trim();
  } else if (items && items.length) {
    acContent = items.map(item => {
      const criteria = (item.acceptance_criteria || []).map((ac, i) => `  ${i + 1}. ${ac}`).join('\n');
      return `[${item.id}] ${item.title}\nPriority: ${item.priority}\n${criteria}`;
    }).join('\n\n');
  }

  if (!acContent) return res.status(400).json({ error: 'AC mətni və ya items tələb olunur' });

  const systemPrompt = `Sən 10+ il təcrübəli senior QA Mühəndisisən. Sənə Acceptance Criteria-lar veriləcək.
Hər AC üçün real, icra edilə bilən Test Case-lər yaz.

TEST CASE YAZMA QAYDALAR:
1. Hər AC üçün minimum 1, maksimum 3 test case yaz
2. Hər test case QA tərəfindən birbaşa icra edilə bilən olmalıdır
3. Addımlar konkret, aydın və ardıcıl olmalıdır - hər addım bir əməliyyatdır
4. Gözlənilən nəticə ölçülə bilən və yoxlanıla bilən olmalıdır
5. Həm müsbət (positive), həm mənfi (negative), həm edge case ssenarilər əhatə et
6. Yalnız Azərbaycan dilində yaz

ÇIXIŞ: Yalnız xam JSON array. Heç bir izahat, markdown yoxdur. [ ilə başla ] ilə bitir.`;

  const userMsg = `Bu Acceptance Criteria-lar üçün Test Case-lər yaz:

${acContent}

JSON FORMAT:
[{
  "id": "TC-001",
  "ac_ref": "AC-001",
  "title": "Test case-in qısa başlığı",
  "type": "positive|negative|edge",
  "priority": "High|Medium|Low",
  "precondition": "Testin icrasından əvvəl sistem hansı vəziyyətdə olmalıdır",
  "steps": [
    "İstifadəçi sistemə daxil olur",
    "İstifadəçi ... düyməsinə basır",
    "Sistem ... cavabı verir"
  ],
  "expected": "Gözlənilən konkret nəticə — sistem nə etməlidir"
}]

Azərbaycan dilində yaz. Yalnız JSON array çıxar.`;

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
      return res.status(500).json({ error: errBody?.error?.message || `HTTP ${anthropicRes.status}` });
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
    if (start === -1 || end === -1) return res.status(500).json({ error: 'JSON tapilmadi', raw: fullText.slice(0, 300) });

    let jsonStr = fullText.slice(start, end + 1)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/,(\s*[}\]])/g, '$1');

    let tcItems;
    try {
      tcItems = JSON.parse(jsonStr);
    } catch {
      const lastComplete = jsonStr.lastIndexOf('},');
      if (lastComplete > 0) {
        try { tcItems = JSON.parse(jsonStr.slice(0, lastComplete + 1) + ']'); } catch {
          return res.status(500).json({ error: 'JSON parse xetasi' });
        }
      } else {
        return res.status(500).json({ error: 'JSON parse xetasi' });
      }
    }

    if (!Array.isArray(tcItems) || !tcItems.length) return res.status(500).json({ error: 'Bos array' });
    return res.status(200).json({ items: tcItems });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
