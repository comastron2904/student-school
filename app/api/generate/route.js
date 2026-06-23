// 서버 측 AI 생성 라우트 — Gemini 키는 여기서만 사용(브라우저 비노출)
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { catOf } from "@/lib/categories";

function buildSystem(cat, subject, target) {
  return `당신은 대한민국 고등학교 학교생활기록부(생기부) 작성을 돕는 전문 보조자입니다. 교사가 입력한 학생 활동 관찰 기록을 바탕으로 교육부 학교생활기록부 기재요령에 부합하는 '${cat.label}'${cat.needsSubject && subject ? ` (과목: ${subject})` : ""} 초안을 작성합니다.

[문체 규칙]
- 명사형 종결('~함', '~음', '~을 보임', '~을 기름' 등)으로 종결한다.
- 학생 이름이나 '나' 등 주어를 쓰지 않는다. 1인칭·구어체·감상문체 금지.
- 관찰 가능한 사실과 구체적 행동을 중심으로, 활동 → 노력·과정 → 역량·성장의 흐름으로 연결한다.
- 추상적 미사여구·과장을 피하고 담백하고 구체적으로 쓴다.
- 여러 활동을 자연스러운 하나의 흐름으로 엮되 단순 나열이 되지 않게 한다.

[영역 관점]
${cat.guide}

[반드시 제외할 항목 — 기재 금지]
- 특정 대학명, 교외 기관·대회명, 교외 수상 실적
- 어학시험·인증시험 점수/급수, 모의고사·교내외 시험 성적
- 부모/친인척의 사회·경제적 지위, 특정 상호·상품명
- 논문 등재, 발명·특허 등 미기재 항목
입력에 이런 내용이 있으면 본문에서 제외하고 notes에 알린다.

[분량] 권장 분량은 한글 약 ${Math.round(target / 3)}자 내외이다. 분량에 억지로 맞추려 하지 말고 활동 내용을 충실하고 자연스럽게 서술하되, 위 권장 글자수를 대략적인 기준으로만 참고한다.

반드시 JSON 형식으로만 출력한다: {"draft": "<생기부 본문>", "notes": "<교사 검토 포인트나 제외한 내용을 1~2문장으로. 없으면 빈 문자열>"}`;
}

function buildUser(cat, activities) {
  const lines = (activities || [])
    .filter((a) => a.title?.trim() || a.detail?.trim() || a.meaning?.trim())
    .map((a, i) => {
      const p = [`활동 ${i + 1}: ${a.title || "(제목 없음)"}`];
      if (a.detail?.trim()) p.push(`  - 한 일/관찰: ${a.detail.trim()}`);
      if (a.meaning?.trim()) p.push(`  - 의미/성장: ${a.meaning.trim()}`);
      return p.join("\n");
    })
    .join("\n\n");
  return `다음은 한 학생의 활동 관찰 기록입니다.\n\n${lines}\n\n위 내용을 종합해 '${cat.label}' 초안을 작성해 주세요.`;
}

async function callGemini(systemText, userText) {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  if (!key) throw new Error("GEMINI_API_KEY 미설정");

  // thinking 토큰이 maxOutputTokens를 잠식해 응답이 잘리는 문제 방지.
  // Gemini 2.5 계열은 thinkingBudget:0으로 비활성화, 3.x 계열은 thinkingLevel 사용.
  const thinkingConfig = model.startsWith("gemini-3")
    ? { thinkingLevel: "low" }
    : { thinkingBudget: 0 };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemText }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
        thinkingConfig,
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status} ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  return text;
}

function parseResult(text) {
  const clean = (text || "").replace(/```json|```/g, "").trim();

  // 1) 정상 JSON
  try {
    const o = JSON.parse(clean);
    return { draft: o.draft || "", notes: o.notes || "" };
  } catch {}

  // 2) 잘린/깨진 JSON에서 draft·notes 문자열만 복구
  const grab = (re) => {
    const m = clean.match(re);
    if (!m) return null;
    try { return JSON.parse('"' + m[1] + '"'); } catch { return m[1]; }
  };
  let draft =
    grab(/"draft"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"notes"/) ?? // notes 앞까지
    grab(/"draft"\s*:\s*"((?:[^"\\]|\\.)*)"/) ??               // 닫는 따옴표 있음
    grab(/"draft"\s*:\s*"((?:[^"\\]|\\.)*)$/);                 // 따옴표 없이 잘림
  if (draft != null) {
    const notes = grab(/"notes"\s*:\s*"((?:[^"\\]|\\.)*)"/) || "";
    return { draft, notes };
  }

  // 3) 최후: 원문 그대로
  return { draft: clean, notes: "" };
}

export async function POST(request) {
  // 로그인 사용자만 호출 허용
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "잘못된 요청" }, { status: 400 }); }

  const { category, subject = "", target = 1500, activities = [], mode = "generate", draft = "", instruction = "" } = body;
  const cat = catOf(category);

  try {
    let systemText = buildSystem(cat, subject, target);
    let userText;
    if (mode === "refine") {
      userText = `다음은 작성된 '${cat.label}' 초안입니다.\n\n"""${draft}"""\n\n[요청] ${instruction}\n같은 JSON 형식으로만 출력해 주세요.`;
    } else {
      userText = buildUser(cat, activities);
    }
    const text = await callGemini(systemText, userText);
    return NextResponse.json(parseResult(text));
  } catch (e) {
    return NextResponse.json({ error: "생성 실패", detail: String(e?.message || e) }, { status: 500 });
  }
}
