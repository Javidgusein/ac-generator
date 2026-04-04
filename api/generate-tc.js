export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!req.body?.acText && !req.body?.items) return res.status(400).json({ error: 'AC content required' });

  await new Promise(r => setTimeout(r, 1500));

  return res.status(200).json({
    mock: true,
    items: [
      {
        "id": "TC-001",
        "ac_ref": "AC-002",
        "title": "Məcburi sahələrin doldurulması yoxlanılması",
        "type": "negative",
        "priority": "High",
        "precondition": "İstifadəçi sistemə daxil olub, forma açıqdır.",
        "steps": [
          "İstifadəçi məcburi sahələri boş buraxır.",
          "İstifadəçi Göndər düyməsinə basır."
        ],
        "expected": "Sistem formu göndərmir, boş sahələrin yanında xəta mesajı göstərir."
      },
      {
        "id": "TC-002",
        "ac_ref": "AC-002",
        "title": "Düzgün məlumat daxil edildikdə forma göndərilməsi",
        "type": "positive",
        "priority": "High",
        "precondition": "İstifadəçi sistemə daxil olub, forma açıqdır.",
        "steps": [
          "İstifadəçi bütün məcburi sahələri düzgün doldurur.",
          "İstifadəçi Göndər düyməsinə basır."
        ],
        "expected": "Sistem formu qəbul edir və növbəti addıma keçir."
      },
      {
        "id": "TC-003",
        "ac_ref": "AC-003",
        "title": "Yanlış məlumat üçün gateway mənfi yolu",
        "type": "negative",
        "priority": "High",
        "precondition": "Forma göndərilib, sistem yoxlama edir.",
        "steps": [
          "Sistem daxil edilən məlumatı yoxlayır.",
          "Məlumat biznes qaydalarına uyğun deyil."
        ],
        "expected": "Sistem xəta mesajı göstərir, istifadəçi düzəliş edə bilir."
      },
      {
        "id": "TC-004",
        "ac_ref": "AC-004",
        "title": "Menecer təsdiqləmə prosesi",
        "type": "positive",
        "priority": "Medium",
        "precondition": "Sorğu menecerə göndərilib.",
        "steps": [
          "Menecer bildiriş alır.",
          "Menecer sorğunu nəzərdən keçirir.",
          "Menecer Təsdiqlə düyməsinə basır."
        ],
        "expected": "Sistem təsdiq qərarını qeyd edir, proses növbəti mərhələyə keçir."
      },
      {
        "id": "TC-005",
        "ac_ref": "AC-004",
        "title": "Menecer rədd etmə prosesi",
        "type": "negative",
        "priority": "Medium",
        "precondition": "Sorğu menecerə göndərilib.",
        "steps": [
          "Menecer bildiriş alır.",
          "Menecer sorğunu nəzərdən keçirir.",
          "Menecer Rədd et düyməsinə basır."
        ],
        "expected": "Sistem rədd qərarını qeyd edir, əlaqədar tərəflərə bildiriş göndərilir."
      }
    ]
  });
}
